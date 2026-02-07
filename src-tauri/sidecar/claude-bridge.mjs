/**
 * Claude Bridge — Node.js process that wraps the @anthropic-ai/claude-agent-sdk.
 *
 * Protocol: newline-delimited JSON on stdin/stdout.
 * Rust spawns one bridge per ConversationView session.
 *
 * Inbound (Rust → Bridge):
 *   { type: "init", projectPath: "..." }
 *   { type: "message", text: "..." }
 *   { type: "permission_response", id: "...", allowed: bool, updatedInput?: {...} }
 *   { type: "abort" }
 *
 * Outbound (Bridge → Rust):
 *   { type: "ready" }
 *   { type: "system", session_id, model }
 *   { type: "message_start" }
 *   { type: "text", text }
 *   { type: "thinking", text }
 *   { type: "tool_use", id, name, input }
 *   { type: "tool_result", tool_use_id, content, is_error }
 *   { type: "permission_request", id, tool, input, description }
 *   { type: "user_question", id, questions }
 *   { type: "result", subtype, session_id, duration_ms, num_turns, model_usage, is_error }
 *   { type: "error", message }
 *   { type: "message_stop" }
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "readline";

let projectPath = null;
let sessionId = null;
let currentQuery = null;

/** Pending permission/question responses: id → { resolve } */
const pendingResponses = new Map();
let permIdCounter = 0;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ---------- canUseTool callback ----------

async function canUseTool(toolName, input, { signal }) {
  const id = String(++permIdCounter);

  if (toolName === "AskUserQuestion") {
    emit({
      type: "user_question",
      id,
      questions: input.questions || [],
    });
  } else {
    let description = `${toolName}`;
    if (toolName === "Bash" && typeof input.command === "string") {
      description =
        input.command.length > 80
          ? input.command.slice(0, 77) + "..."
          : input.command;
    } else if (
      (toolName === "Read" || toolName === "Write" || toolName === "Edit") &&
      typeof input.file_path === "string"
    ) {
      const parts = input.file_path.replace(/\\/g, "/").split("/");
      description = parts.slice(-2).join("/");
    }

    emit({
      type: "permission_request",
      id,
      tool: toolName,
      input,
      description,
    });
  }

  return new Promise((resolve, reject) => {
    pendingResponses.set(id, { resolve });
    signal?.addEventListener(
      "abort",
      () => {
        pendingResponses.delete(id);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

// ---------- Run a single query ----------

async function runQuery(text) {
  emit({ type: "message_start" });

  /** Accumulate tool_use input from stream deltas: blockIndex → { id, name, inputJson } */
  const pendingToolBlocks = new Map();

  const options = {
    cwd: projectPath,
    canUseTool,
    includePartialMessages: true,
    abortController: new AbortController(),
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  currentQuery = query({ prompt: text, options });

  try {
    for await (const msg of currentQuery) {
      switch (msg.type) {
        case "system": {
          if (msg.subtype === "init") {
            sessionId = msg.session_id;
            emit({
              type: "system",
              session_id: msg.session_id,
              model: msg.model || "",
            });
          }
          break;
        }

        case "assistant": {
          // Skip — text, thinking, and tool_use are all handled via
          // stream_event to avoid double-emission. The full assistant
          // message would duplicate what we already streamed.
          break;
        }

        case "user": {
          // Tool results from Claude's tool execution
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "tool_result") {
                const contentText =
                  typeof block.content === "string"
                    ? block.content
                    : Array.isArray(block.content)
                      ? block.content
                          .filter((c) => c.type === "text")
                          .map((c) => c.text)
                          .join("\n")
                      : "";
                emit({
                  type: "tool_result",
                  tool_use_id: block.tool_use_id,
                  content: contentText,
                  is_error: block.is_error || false,
                });
              }
            }
          }
          break;
        }

        case "result": {
          const mu = msg.modelUsage || {};
          emit({
            type: "result",
            subtype: msg.subtype || "success",
            session_id: msg.session_id || sessionId || "",
            duration_ms: msg.duration_ms || 0,
            num_turns: msg.num_turns || 0,
            is_error: msg.subtype !== "success",
            model_usage: mu,
          });
          break;
        }

        case "stream_event": {
          const ev = msg.event;
          if (!ev) break;

          if (ev.type === "content_block_start") {
            const block = ev.content_block;
            if (block?.type === "thinking") {
              emit({ type: "thinking", text: block.thinking || "" });
            } else if (block?.type === "tool_use") {
              // Start accumulating input JSON for this tool_use block
              pendingToolBlocks.set(ev.index, {
                id: block.id,
                name: block.name,
                inputJson: "",
              });
            }
          } else if (ev.type === "content_block_delta") {
            const delta = ev.delta;
            if (delta?.type === "text_delta") {
              emit({ type: "text", text: delta.text });
            } else if (delta?.type === "thinking_delta") {
              emit({ type: "thinking", text: delta.thinking });
            } else if (delta?.type === "input_json_delta") {
              // Accumulate partial JSON for the pending tool_use block
              const pending = pendingToolBlocks.get(ev.index);
              if (pending) {
                pending.inputJson += delta.partial_json;
              }
            }
          } else if (ev.type === "content_block_stop") {
            // Emit complete tool_use with fully accumulated input
            const pending = pendingToolBlocks.get(ev.index);
            if (pending) {
              pendingToolBlocks.delete(ev.index);
              let input = {};
              try {
                input = JSON.parse(pending.inputJson);
              } catch {
                // Partial or invalid JSON — emit with empty input
              }
              emit({
                type: "tool_use",
                id: pending.id,
                name: pending.name,
                input,
              });
            }
          }
          break;
        }
      }
    }
  } catch (err) {
    if (err.message !== "aborted") {
      emit({ type: "error", message: String(err.message || err) });
    }
  } finally {
    currentQuery = null;
    emit({ type: "message_stop" });
    emit({ type: "ready" });
  }
}

// ---------- stdin command router ----------

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }

  switch (cmd.type) {
    case "init": {
      projectPath = cmd.projectPath;
      emit({ type: "ready" });
      break;
    }

    case "message": {
      runQuery(cmd.text);
      break;
    }

    case "permission_response": {
      const pending = pendingResponses.get(cmd.id);
      if (!pending) break;
      pendingResponses.delete(cmd.id);

      if (cmd.allowed) {
        pending.resolve({
          behavior: "allow",
          updatedInput: cmd.updatedInput || undefined,
        });
      } else {
        pending.resolve({
          behavior: "deny",
          message: cmd.message || "User denied permission",
        });
      }
      break;
    }

    case "abort": {
      if (currentQuery && typeof currentQuery.interrupt === "function") {
        currentQuery.interrupt().catch(() => {});
      }
      break;
    }
  }
});

rl.on("close", () => {
  process.exit(0);
});
