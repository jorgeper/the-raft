import { Link, useNavigate, useParams } from 'react-router-dom';
import Pills from '../components/Pills';
import { findLibraryExercise, useLibrary } from '../hooks/useLibrary';

export default function ExerciseDetail() {
  const { name } = useParams<{ name: string }>();
  const library = useLibrary();
  const navigate = useNavigate();

  if (!library) return <p className="py-10 text-center text-muted">Loading…</p>;

  const exercise = name ? findLibraryExercise(library, decodeURIComponent(name)) : null;
  if (!exercise) {
    return (
      <div className="py-10 text-center">
        <p className="text-muted">That exercise isn’t in the library.</p>
        <Link to="/settings/library" className="mt-2 inline-block text-[12.8px]">
          ← Back to the library
        </Link>
      </div>
    );
  }

  const alternatives = (exercise.alternatives ?? []).map((alt) => ({
    name: alt,
    inLibrary: findLibraryExercise(library, alt) !== null,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">{exercise.name}</h1>
        <Link to="/settings/library" className="text-[12px]">
          ← Library
        </Link>
      </div>

      <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <Pills exercise={exercise} />
        {exercise.description && <p className="mt-2.5 text-[12.8px] text-ink2">{exercise.description}</p>}
      </div>

      {alternatives.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          <h2 className="text-[12.5px] font-[600] text-ink2">Alternatives</h2>
          <div className="mt-1.5 flex flex-col">
            {alternatives.map((alt) =>
              alt.inLibrary ? (
                <button
                  key={alt.name}
                  type="button"
                  onClick={() => navigate(`/settings/library/${encodeURIComponent(alt.name)}`)}
                  className="flex items-center justify-between border-b border-grid py-2 text-left text-[12.8px] text-ink last:border-b-0 hover:bg-surface2"
                >
                  {alt.name}
                  <span className="text-muted">→</span>
                </button>
              ) : (
                <span
                  key={alt.name}
                  className="border-b border-grid py-2 text-[12.8px] text-ink2 last:border-b-0"
                >
                  {alt.name}
                </span>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
