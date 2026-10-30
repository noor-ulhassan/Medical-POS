/**
 * Shown while the app starts. index.html contains the same markup, so the
 * picture is on screen before the interface has loaded and nothing flickers
 * when React takes over.
 */
export function StartupScreen() {
  return (
    <div className="start-backdrop flex h-full items-center justify-center p-6" id="startupScreen">
      <div className="flex flex-col items-center rounded-dialog border border-foil bg-surface px-10 py-8 shadow-dialog">
        <img src="./icon.png" alt="" className="size-14 rounded-xl" />
        <div className="mt-4 text-lg font-bold text-ink">Noor Pharmacy POS</div>
        <div className="mt-2 flex items-center gap-2.5 text-base text-ink-2" role="status">
          <span className="size-4 animate-spin rounded-full border-2 border-teal border-t-transparent" aria-hidden="true" />
          Starting, please wait…
        </div>
      </div>
    </div>
  );
}
