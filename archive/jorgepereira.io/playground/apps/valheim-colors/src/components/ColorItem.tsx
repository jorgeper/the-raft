import { useState, useRef, useEffect } from "react";
import { parseColor, replaceColor } from "../colors";

interface Props {
  code: string;
  editMode: boolean;
  onUpdate: (newCode: string) => void;
  onDelete: () => void;
  onCopy: (code: string) => void;
}

export function ColorItem({ code, editMode, onUpdate, onDelete, onCopy }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(code);
  }, [code]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const color = parseColor(editing ? value : code) ?? undefined;

  function handlePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newCode = replaceColor(editing ? value : code, e.target.value);
    if (editing) {
      setValue(newCode);
    } else {
      onUpdate(newCode);
    }
  }

  if (editMode && editing) {
    return (
      <div className="color-item" style={{ color }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (value.trim()) onUpdate(value.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (value.trim()) onUpdate(value.trim());
              setEditing(false);
            }
            if (e.key === "Escape") {
              setValue(code);
              setEditing(false);
            }
          }}
          style={{ color }}
        />
        <label className="picker-btn" title="Pick color">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.4 2.6a2 2 0 0 0-2.8 0L3.3 9.9l-.8 3.6 3.6-.8L13.4 5.4a2 2 0 0 0 0-2.8ZM5.4 11.2l-.6.6-1.5.3.3-1.5.6-.6 1.2 1.2Zm1-1L5.2 9l5-5 1.2 1.2-5 5Z"/></svg>
          <input
            ref={pickerRef}
            type="color"
            value={color || "#ffffff"}
            onChange={handlePickerChange}
          />
        </label>
        <button className="delete-color" onClick={onDelete}>
          &times;
        </button>
      </div>
    );
  }

  return (
    <div
      className="color-item"
      style={{ color }}
      onClick={() => (editMode ? setEditing(true) : onCopy(code))}
    >
      <span className="code-text">{code}</span>
      {editMode && (
        <>
          <label className="picker-btn" title="Pick color" onClick={(e) => e.stopPropagation()}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M13.4 2.6a2 2 0 0 0-2.8 0L3.3 9.9l-.8 3.6 3.6-.8L13.4 5.4a2 2 0 0 0 0-2.8ZM5.4 11.2l-.6.6-1.5.3.3-1.5.6-.6 1.2 1.2Zm1-1L5.2 9l5-5 1.2 1.2-5 5Z"/></svg>
            <input
              type="color"
              value={color || "#ffffff"}
              onChange={handlePickerChange}
            />
          </label>
          <button
            className="delete-color"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            &times;
          </button>
        </>
      )}
    </div>
  );
}
