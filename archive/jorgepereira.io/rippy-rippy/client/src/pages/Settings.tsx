import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { putProfile } from '../api';
import AvatarPicker from '../components/AvatarPicker';
import { useAuth } from '../auth';
import { clearSettingsCache, updateSettings, useSettings } from '../hooks/useSettings';
import type { WeightUnit } from '../types';

interface Profile {
  email: string;
  name: string;
  customAvatar: string | null;
  googlePicture: string | null;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
      <h2 className="text-[12.5px] font-[600] text-ink2">{title}</h2>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-ctl bg-surface2 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={
            'rounded-[5px] px-3.5 py-1.5 text-[12.5px] font-[550] ' +
            (value === v ? 'bg-ink text-page' : 'text-ink2 hover:bg-surface3')
          }
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function Settings() {
  const { refresh, signOut } = useAuth();
  const settings = useSettings();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    void fetch('/api/profile')
      .then((r) => r.json())
      .then(({ profile }: { profile: Profile }) => {
        setProfile(profile);
        setName(profile.name);
      });
  }, []);

  async function changeAvatar(avatar: string | null) {
    const patch = avatar === null ? { useGooglePhoto: true } : { avatar };
    await putProfile(patch);
    setProfile((p) => (p ? { ...p, customAvatar: avatar } : p));
    await refresh(); // header avatar updates immediately
  }

  async function commitName() {
    const trimmed = name.trim();
    if (!profile || !trimmed || trimmed === profile.name) {
      setName(profile?.name ?? '');
      return;
    }
    await putProfile({ name: trimmed });
    setProfile((p) => (p ? { ...p, name: trimmed } : p));
    await refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">Settings</h1>

      <Card title="Profile">
        {profile === null ? (
          <p className="text-[12px] text-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <AvatarPicker
              name={profile.name}
              value={profile.customAvatar}
              fallbackSrc={profile.googlePicture}
              onChange={(avatar) => void changeAvatar(avatar)}
            />
            <div>
              <label htmlFor="display-name" className="block text-[10.5px] uppercase tracking-wider text-muted">
                Display name
              </label>
              <input
                id="display-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="mt-1 w-full max-w-xs rounded-ctl border border-line bg-surface2 px-3 py-2 text-ink"
              />
            </div>
            <p className="text-[11.5px] text-muted">Signed in as {profile.email}</p>
          </div>
        )}
      </Card>

      <Card title="Weight unit">
        <Segmented<WeightUnit>
          label="Weight unit"
          value={settings.weightUnit}
          options={[
            ['lb', 'Pounds (lb)'],
            ['kg', 'Kilograms (kg)'],
          ]}
          onChange={(weightUnit) => void updateSettings({ ...settings, weightUnit })}
        />
        <p className="mt-2 text-[11.5px] text-muted">
          A display label, not a conversion — weights stay exactly as you logged them.
        </p>
      </Card>

      <Card title="Exercise library">
        <Link to="/settings/library" className="text-[12.8px]">
          Browse the exercise library →
        </Link>
        <p className="mt-1 text-[11.5px] text-muted">
          103 exercises with descriptions, muscle groups, and alternatives.
        </p>
      </Card>

      <Card title="Account">
        <button
          type="button"
          onClick={() => {
            clearSettingsCache();
            void signOut().then(() => navigate('/login'));
          }}
          className="rounded-ctl bg-surface3 px-4 py-2 text-[12.5px] font-[550] text-ink2 hover:bg-baseline"
        >
          Log out
        </button>
      </Card>
    </div>
  );
}
