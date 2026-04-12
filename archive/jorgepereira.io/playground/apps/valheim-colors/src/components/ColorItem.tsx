import { useState, useRef, useEffect } from "react";
import { parseColor } from "../colors";

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
        <button
          className="delete-color"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          &times;
        </button>
      )}
    </div>
  );
}
