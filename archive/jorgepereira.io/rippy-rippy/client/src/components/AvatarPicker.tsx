import { useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import Avatar from './Avatar';
import Modal from './Modal';

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

/**
 * Profile-photo flow (same UX as buckos): pick a file, zoom/pan inside a
 * round mask, store a small square image. The Google account photo is the
 * fallback whenever no custom photo is set.
 */
export default function AvatarPicker({
  name,
  value,
  fallbackSrc,
  onChange,
}: {
  name: string;
  value: string | null; // custom photo — always wins
  fallbackSrc: string | null; // Google account photo
  onChange: (avatar: string | null) => void;
}) {
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

  const btn = 'rounded-ctl bg-surface2 px-3.5 py-2 text-[12.5px] font-[550] text-ink2 hover:bg-surface3';

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || '?'} src={value ?? fallbackSrc} size={64} />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className={btn}>
            {value || fallbackSrc ? 'Change photo' : 'Upload photo'}
          </button>
          {value && (
            <button type="button" onClick={() => onChange(null)} className={btn}>
              {fallbackSrc ? 'Use my Google photo' : 'Remove'}
            </button>
          )}
        </div>
        {!value && fallbackSrc && (
          <p className="mt-1.5 text-[11.5px] text-muted">Using your Google account photo.</p>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose profile photo"
        onChange={(e) => {
          openFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {rawImage && (
        <Modal title="Adjust photo" onClose={() => setRawImage(null)}>
          <div className="relative mb-4 h-72 overflow-hidden rounded-card" style={{ background: 'var(--ink)' }}>
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
          <label className="mb-4 flex items-center gap-3 text-[12px] text-ink2">
            Zoom
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-8 flex-1"
              style={{ accentColor: 'var(--accent)' }}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRawImage(null)}
              className="flex-1 rounded-ctl bg-surface3 py-2.5 text-[12.5px] font-[550] text-ink2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !areaPixels}
              onClick={() => void usePhoto()}
              className="flex-1 rounded-ctl bg-ink py-2.5 text-[12.5px] font-[550] text-page disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Use photo'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
