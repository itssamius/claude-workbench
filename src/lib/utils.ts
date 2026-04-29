export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function tildeify(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~');
}

export function relativeTime(createdAt: number): string {
  const elapsed = Date.now() - createdAt;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function diffStats(patch: string): { additions: number; deletions: number } {
  let additions = 0, deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

export function deriveHeuristicTitle(prompt: string): string {
  const stripped = prompt.trim().replace(/^(can you|could you|please|hey|hi)[,\s]+/i, '').trim();
  const sentence = (stripped.split(/[.!?\n]/)[0] ?? stripped).trim();
  const capped = sentence.length > 48 ? sentence.slice(0, 48) : sentence;
  return capped.replace(/\b\w/g, c => c.toUpperCase());
}
