export function getActiveBranchId(user?: { branchId?: string } | null): string {
  return localStorage.getItem('rms-active-branch') || user?.branchId || '';
}

export function listenForBranchChanges(callback: () => void): () => void {
  window.addEventListener('rms-branch-changed', callback);
  return () => window.removeEventListener('rms-branch-changed', callback);
}
