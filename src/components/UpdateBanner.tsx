import { useUpdaterStore } from "../stores/updaterStore";

export function UpdateBanner() {
  const status = useUpdaterStore((s) => s.status);
  const updateInfo = useUpdaterStore((s) => s.updateInfo);
  const downloadProgress = useUpdaterStore((s) => s.downloadProgress);
  const downloadAndInstall = useUpdaterStore((s) => s.downloadAndInstall);
  const dismiss = useUpdaterStore((s) => s.dismiss);

  if (status === "idle" || status === "checking" || status === "error") {
    return null;
  }

  if (status === "ready") {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--accent)] text-white text-xs">
        <span>Update installed. Restarting...</span>
      </div>
    );
  }

  if (status === "downloading") {
    return (
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--accent)] text-white text-xs">
        <div className="flex items-center gap-3 flex-1">
          <span>Downloading update...</span>
          <div className="flex-1 max-w-xs h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/80 rounded-full transition-all"
              style={{ width: downloadProgress > 0 ? `${downloadProgress}%` : "100%" }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[var(--accent)] text-white text-xs">
      <span>Update available (v{updateInfo?.version})</span>
      <div className="flex items-center gap-2">
        <button
          onClick={downloadAndInstall}
          className="ml-4 hover:opacity-70 font-bold underline"
        >
          Install
        </button>
        <button
          onClick={dismiss}
          className="ml-2 hover:opacity-70 font-bold"
        >
          ×
        </button>
      </div>
    </div>
  );
}
