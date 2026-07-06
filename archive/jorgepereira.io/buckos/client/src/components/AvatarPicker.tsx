import { useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import Modal from './Modal';
import Avatar from './Avatar';

/** Render the selected crop area to a small square JPEG data URL. */
async function cropToDataUrl(src: string, area: Area): Promise<string> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 256, 256);
  return canvas.toDataURL('image/jpeg', 0.85);
}

interface Props {
  name: string; // for the initials fallback
  value: string | null;
  onChange: (avatar: string | null) => void;
}

/**
 * The classic profile-photo flow: pick a file, then zoom/pan inside a round
 * mask until it looks right. The result is stored as a small square image and
 * displayed as a circle.
 */
export default function AvatarPicker({ name, value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const openFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setAreaPixels(null);
      setRawImage(String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const usePhoto = async () => {
    if (!rawImage || !areaPixels) return;
    setBusy(true);
    try {
      onChange(await cropToDataUrl(rawImage, areaPixels));
      setRawImage(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || '?'} src={value} size={64} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="min-h-11 rounded-pill border border-line px-4 font-medium text-ink transition-colors hover:bg-sunken"
        >
          {value ? 'Change photo' : 'Upload photo'}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="min-h-11 rounded-pill px-4 font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-negative"
          >
            Remove
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          openFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {rawImage && (
        <Modal title="Adjust photo" onClose={() => setRawImage(null)}>
          <div className="relative mb-4 h-72 overflow-hidden rounded-card bg-ink/90">
            <Cropper
              image={rawImage}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={4}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, px) => setAreaPixels(px)}
            />
          </div>
          <label className="mb-4 flex items-center gap-3 text-sm text-ink-muted">
            Zoom
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-11 flex-1 accent-(--accent)"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRawImage(null)}
              className="min-h-12 flex-1 rounded-pill border border-line font-medium text-ink transition-colors hover:bg-sunken"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !areaPixels}
              onClick={() => void usePhoto()}
              className="min-h-12 flex-1 rounded-pill bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Use photo'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
