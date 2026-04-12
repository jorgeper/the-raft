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
        <input
          ref={pickerRef}
          type="color"
          className="color-picker"
          value={color || "#ffffff"}
          onChange={handlePickerChange}
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
        <>
          <input
            type="color"
            className="color-picker"
            value={color || "#ffffff"}
            onChange={handlePickerChange}
            onClick={(e) => e.stopPropagation()}
          />
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
