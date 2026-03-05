import { useEffect, useRef } from "react";
import { useVoiceStore } from "../stores/voiceStore";
import { voiceInputController } from "../lib/voiceInput";

interface VoiceTranscriptBoxProps {
  tabId: string;
  onSubmit?: (text: string) => void;
}

export function VoiceTranscriptBox({ tabId, onSubmit }: VoiceTranscriptBoxProps) {
  const isListening = useVoiceStore((s) => s.isListening);
  const statusMessage = useVoiceStore((s) => s.statusMessage);
  const targetTabId = useVoiceStore((s) => s.targetTabId);
  const transcriptText = useVoiceStore((s) => s.transcriptText);
  const setTranscriptText = useVoiceStore((s) => s.setTranscriptText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isTargetTab = targetTabId === tabId;
  const hasTranscript = transcriptText.length > 0;
  const isActive = isTargetTab && (isListening || hasTranscript || statusMessage);

  useEffect(() => {
    if (isActive) {
      textareaRef.current?.focus();
    }
  }, [isActive]);

  if (!isActive) return null;

  function dismiss() {
    useVoiceStore.getState().setIdle();
    voiceInputController.stop();
  }

  function handleSubmit() {
    const text = transcriptText.trim();
    if (!text) return;
    onSubmit?.(text);
    dismiss();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss();
    }
  }

  return (
    <div className="voice-transcript-box">
      <div className="voice-transcript-top-row">
        <div className="voice-transcript-status">
          {isListening && <span className="voice-transcript-indicator">*</span>}
          <span className="voice-transcript-message">{statusMessage || "voice"}</span>
        </div>
        <button className="voice-transcript-dismiss" onClick={dismiss}>
          :esc
        </button>
      </div>
      <div className="voice-transcript-input-row">
        <span className="voice-transcript-prefix">{">"}</span>
        <textarea
          ref={textareaRef}
          className="voice-transcript-textarea"
          value={transcriptText}
          onChange={(e) => setTranscriptText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="speak or type..."
          rows={1}
        />
        <button
          className="voice-transcript-send-btn"
          onClick={handleSubmit}
          disabled={!transcriptText.trim()}
        >
          :send
        </button>
      </div>
    </div>
  );
}
