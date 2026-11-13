// Library status and the refresh that follows an import or rebuild.
import { errorText, isBusy, libraryStatus } from "./api";
import { store } from "./store.svelte";
import { clearThreadCache } from "./threads";

const RETRY_MS = 2000;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Read library_status into the store. While the library is busy, retry quietly every 2 s. */
export async function refreshStatus(): Promise<void> {
  clearTimeout(timer);
  try {
    store.status = await libraryStatus();
    store.statusError = null;
  } catch (err) {
    if (isBusy(err)) timer = setTimeout(() => void refreshStatus(), RETRY_MS);
    else store.statusError = errorText(err);
  }
}

/** After a successful (or interrupted) import or rebuild: drop cached threads,
 *  re-run the current search, refresh the message count and needs_rebuild. */
export async function afterLibraryChange(): Promise<void> {
  clearThreadCache();
  store.refresh++;
  await refreshStatus();
}
