import { useState, useRef, useEffect } from "react";
import type { Group } from "../types";
import { ColorItem } from "./ColorItem";

interface Props {
  group: Group;
  editMode: boolean;
  onUpdateGroup: (updated: Group) => void;
  onDeleteGroup: () => void;
  onCopy: (code: string) => void;
}

export function GroupCard({
  group,
  editMode,
  onUpdateGroup,
  onDeleteGroup,
  onCopy,
}: Props) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(group.name);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameValue(group.name);
  }, [group.name]);

  useEffect(() => {
    if (editingName && nameRef.current) {
      nameRef.current.focus();
      nameRef.current.select();
    }
  }, [editingName]);

  function commitName() {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== group.name) {
      onUpdateGroup({ ...group, name: trimmed });
    }
    setEditingName(false);
  }

  function updateColor(index: number, newCode: string) {
    const colors = [...group.colors];
    colors[index] = newCode;
    onUpdateGroup({ ...group, colors });
  }

  function deleteColor(index: number) {
    const colors = group.colors.filter((_, i) => i !== index);
    onUpdateGroup({ ...group, colors });
  }

  function addColor() {
    onUpdateGroup({ ...group, colors: [...group.colors, "<#ffffff>New Item"] });
  }

  return (
    <div className="group-card">
      <div className="group-header">
        {editMode && editingName ? (
          <input
            ref={nameRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setNameValue(group.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <span
            style={editMode ? { cursor: "pointer" } : undefined}
            onClick={() => editMode && setEditingName(true)}
          >
            {group.name}
          </span>
        )}
        {editMode && (
          <button className="delete-group" onClick={onDeleteGroup}>
            &times;
          </button>
        )}
      </div>
      {group.colors.map((code, i) => (
        <ColorItem
          key={i}
          code={code}
          editMode={editMode}
          onUpdate={(c) => updateColor(i, c)}
          onDelete={() => deleteColor(i)}
          onCopy={onCopy}
        />
      ))}
      {editMode && (
        <button className="add-btn" onClick={addColor}>
          + Add Color
        </button>
      )}
    </div>
  );
}
