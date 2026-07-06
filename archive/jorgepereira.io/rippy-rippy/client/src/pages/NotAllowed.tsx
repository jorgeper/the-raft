export default function NotAllowed() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="font-serif text-[22px] font-[650] text-ink">You’re not on the list</h1>
      <p className="mt-2 max-w-sm text-[12.8px] text-ink2">
        Rippy Rippy is invite-only. Ask Jorge to add your Google account email, then try signing in
        again.
      </p>
      <a href="/login" className="mt-6 text-[13px]">
        Back to sign in
      </a>
    </div>
  );
}
