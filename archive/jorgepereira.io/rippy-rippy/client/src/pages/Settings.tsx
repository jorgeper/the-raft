import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { devGenerateDays, devGenerateWorkouts, devReset, getProfile, importData, putProfile } from '../api';
import AvatarPicker from '../components/AvatarPicker';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../auth';
import { clearSettingsCache, updateSettings, useSettings } from '../hooks/useSettings';
import { shiftDateStr, todayStr } from '../lib';
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
  const [importResult, setImportResult] = useState<string | null>(null);
  const [devMessage, setDevMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getProfile().then(({ profile }) => {
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

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImportResult(null);
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const { result } = await importData(payload);
      setImportResult(
        `Imported ${result.daysImported} day${result.daysImported === 1 ? '' : 's'} and ` +
          `${result.workoutsImported} workout${result.workoutsImported === 1 ? '' : 's'}` +
          (result.daysSkipped + result.workoutsSkipped > 0
            ? ` (skipped ${result.daysSkipped} days / ${result.workoutsSkipped} workouts that already exist)`
            : '') +
          '.'
      );
    } catch (err) {
      setImportResult(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed.');
    }
  }

  async function generateDays() {
    const start = shiftDateStr(todayStr(), -14);
    const { generated } = await devGenerateDays(start, 14);
    setDevMessage(`Generated ${generated} workout days over the last two weeks.`);
  }

  async function generateWorkouts() {
    const { added } = await devGenerateWorkouts();
    setDevMessage(added > 0 ? `Added ${added} sample workouts.` : 'Sample workouts already exist.');
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

      <Card title="Your data">
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/export"
            download="rippy-rippy-export.json"
            className="rounded-ctl bg-surface2 px-3.5 py-2 text-[12.5px] font-[550] text-ink2 no-underline hover:bg-surface3"
          >
            Export everything (JSON)
          </a>
          <button
            type="button"
            onClick={() => importFileRef.current?.click()}
            className="rounded-ctl bg-surface2 px-3.5 py-2 text-[12.5px] font-[550] text-ink2 hover:bg-surface3"
          >
            Import from Workout Book…
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import data file"
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          Import accepts a Rippy Rippy export or the old Workout Book localStorage JSON
          (<code>wb_days</code> / <code>wb_saved_workouts</code>). Days you already logged here are
          never overwritten.
        </p>
        {importResult && <p className="mt-2 text-[12px] text-ink2">{importResult}</p>}
      </Card>

      <Card title="Developer mode">
        <Segmented<'on' | 'off'>
          label="Developer mode"
          value={settings.devMode ? 'on' : 'off'}
          options={[
            ['off', 'Off'],
            ['on', 'On'],
          ]}
          onChange={(v) => void updateSettings({ ...settings, devMode: v === 'on' })}
        />
        {settings.devMode && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void generateDays()}
              className="rounded-ctl bg-surface2 px-3.5 py-2 text-[12.5px] font-[550] text-ink2 hover:bg-surface3"
            >
              Generate 2 weeks of test data
            </button>
            <button
              type="button"
              onClick={() => void generateWorkouts()}
              className="rounded-ctl bg-surface2 px-3.5 py-2 text-[12.5px] font-[550] text-ink2 hover:bg-surface3"
            >
              Generate sample workouts
            </button>
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              className="rounded-ctl px-3.5 py-2 text-[12.5px] font-[550] text-crit hover:bg-crit-bg"
            >
              Reset all my data…
            </button>
          </div>
        )}
        {devMessage && <p className="mt-2 text-[12px] text-ink2">{devMessage}</p>}
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

      {confirmingReset && (
        <ConfirmDialog
          title="Reset all your data?"
          message="Every day, saved workout, and setting on your account will be deleted. Other users are untouched. This cannot be undone."
          confirmLabel="Delete everything"
          onConfirm={() => {
            void devReset().then(() => {
              setConfirmingReset(false);
              setDevMessage('All your data was deleted.');
            });
          }}
          onCancel={() => setConfirmingReset(false)}
        />
      )}
    </div>
  );
}
