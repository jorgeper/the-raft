import { useEffect } from "react";

interface Props {
  message: string;
  visible: boolean;
  onHide: () => void;
}

export function Toast({ message, visible, onHide }: Props) {
  useEffect(() => {
    if (visible) {
      const t = setTimeout(onHide, 1500);
      return () => clearTimeout(t);
    }
  }, [visible, onHide]);

  return <div className={`toast ${visible ? "visible" : ""}`}>{message}</div>;
}
