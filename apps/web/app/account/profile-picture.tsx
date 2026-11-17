'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Dialog } from '../../components/ux/dialog';
import { sessionHeaders } from './workspace-lifecycle-client';
import {
  pictureChangedEvent,
  pictureEndpoint,
  pictureSource,
} from '../../lib/profile-picture-client';
import './profile-picture.css';

// ADR-088. The person's own profile picture on My Profile: choose a file, drop one, or take a photo where the device
// offers a camera; move and zoom it inside a circle; upload with progress. The server checks the real bytes and redraws
// them without metadata, so this screen only helps the person send a sensible square. Only the person sees the picture.
// Every state is drawn: loading, empty, choosing, uploading with progress, slow, failed with a reason, too large, wrong
// type, success, and the remove confirmation. Shown only while the profilePicture capability is on.

const accepted = ['image/jpeg', 'image/png', 'image/webp'];
const maxBytes = 8 * 1024 * 1024;
const minSide = 128;
const outputSide = 1024;
const slowAfterMs = 8000;
type View = { currentVersion: number; picture: { version: number; updatedAt: string } | null };
type Load = 'loading' | 'ready' | 'missing' | 'failed';
type Crop = { bitmap: ImageBitmap; url: string; zoom: number; x: number; y: number };
const words = {
  empty: 'No picture yet. Your initials are shown instead.',
  who: 'Only you can see your picture.',
  rules: 'JPEG, PNG or WebP, up to 8 MB, at least 128 pixels on each side.',
  loading: 'Loading your picture...',
  missing: 'Profile pictures are not available yet.',
  readFailed: 'Your picture could not be loaded.',
  tooLarge: 'This picture is larger than 8 MB. Choose a smaller one.',
  wrongType: 'Use a JPEG, PNG or WebP picture.',
  unreadable: 'This picture could not be read. Use a JPEG, PNG or WebP picture.',
  tooSmall: 'This picture is too small. Use one at least 128 pixels on each side.',
  slow: 'This is taking longer than usual. Keep this page open.',
  saved: 'Picture saved.',
  removed: 'Picture removed.',
  offline: 'The upload did not finish. Check your connection and try again.',
  failed: 'The picture could not be saved. Please try again.',
};
// Plain words for every code the route answers with.
const codeWords: Record<string, string> = {
  too_large: words.tooLarge,
  wrong_type: words.wrongType,
  empty: 'This file is empty. Choose a picture.',
  animated: 'Moving pictures are not supported. Choose a still picture.',
  too_small: words.tooSmall,
  too_big_in_pixels: 'This picture has too many pixels. Use one under 8000 pixels on each side.',
  unreadable: words.unreadable,
  rate_limited: 'Too many picture uploads. Try again in an hour.',
  stale: 'Your picture changed in another window. We loaded the latest; try again.',
  no_workspace:
    'Personal details need a workspace on this account. Create or join a workspace first.',
  account_inactive:
    'The picture cannot be changed while your account is closed or an erasure request is open.',
  no_picture: 'There is no picture to remove.',
  storage_unavailable: 'The picture could not be stored. Try again in a few minutes.',
  module_unavailable: words.missing,
  signed_out: 'Sign in again to change your picture.',
};
const coarseQuery = '(pointer: coarse)';
const readCoarse = () => window.matchMedia?.(coarseQuery).matches ?? false;
function subscribeCoarse(change: () => void) {
  const list = window.matchMedia?.(coarseQuery);
  list?.addEventListener('change', change);
  return () => list?.removeEventListener('change', change);
}
const wordsFor = (code: unknown) => (typeof code === 'string' && codeWords[code]) || words.failed;

export function ProfilePicture({
  subject,
  issuer,
  initials,
  onChange,
}: {
  subject: string;
  issuer: string;
  initials: string;
  onChange?: (version: number | null) => void;
}) {
  const [load, setLoad] = useState<Load>('loading');
  const [view, setView] = useState<View | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  // "Take a Photo" is offered on touch devices, where the browser opens the camera for a capture input.
  const camera = useSyncExternalStore(subscribeCoarse, readCoarse, () => false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const changeButton = useRef<HTMLButtonElement>(null);
  const pending = useRef<{ commandId: string; blob: Blob } | null>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const publish = useCallback(
    (next: View) => {
      setView(next);
      const version = next.picture ? next.currentVersion : null;
      onChange?.(version);
      window.dispatchEvent(new CustomEvent(pictureChangedEvent, { detail: version }));
    },
    [onChange],
  );
  const reload = useCallback(async () => {
    setLoad('loading');
    try {
      const response = await fetch(`${pictureEndpoint}?scope=view`, {
        cache: 'no-store',
        headers: sessionHeaders(subject, issuer),
      });
      if (response.status === 404 || response.status === 503) return setLoad('missing');
      if (!response.ok) return setLoad('failed');
      publish((await response.json()) as View);
      setLoad('ready');
    } catch {
      setLoad('failed');
    }
  }, [subject, issuer, publish]);
  useEffect(() => {
    // The first read starts here; its answer updates the state when it settles.
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  // The chosen file is released when another is chosen or the framing closes; moving and zooming keep it.
  const bitmap = crop?.bitmap,
    preview = crop?.url;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
      bitmap?.close();
    },
    [bitmap, preview],
  );

  async function choose(file: File | undefined) {
    setProblem(null);
    setStatus('');
    if (!file) return;
    if (!accepted.includes(file.type)) return setProblem(words.wrongType);
    if (file.size > maxBytes) return setProblem(words.tooLarge);
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return setProblem(words.unreadable);
    }
    if (bitmap.width < minSide || bitmap.height < minSide) {
      bitmap.close();
      return setProblem(words.tooSmall);
    }
    pending.current = null;
    setCrop({ bitmap, url: URL.createObjectURL(file), zoom: 1, x: 0, y: 0 });
  }

  // The visible square shows the picture scaled to cover it, then zoomed; x and y move it in square units (-0.5 to 0.5),
  // kept so the square stays covered.
  function clamp(next: Crop): Crop {
    const { width, height } = next.bitmap;
    const cover = Math.max(1 / width, 1 / height);
    const spanX = (width * cover * next.zoom - 1) / 2,
      spanY = (height * cover * next.zoom - 1) / 2;
    return {
      ...next,
      x: Math.max(-spanX, Math.min(spanX, next.x)),
      y: Math.max(-spanY, Math.min(spanY, next.y)),
    };
  }
  const move = (dx: number, dy: number) =>
    crop && setCrop(clamp({ ...crop, x: crop.x + dx, y: crop.y + dy }));
  const zoomTo = (zoom: number) =>
    crop && setCrop(clamp({ ...crop, zoom: Math.max(1, Math.min(4, zoom)) }));
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!crop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, startX: crop.x, startY: crop.y };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const size = stage.current?.clientWidth ?? 1;
    if (!start || !crop) return;
    setCrop(
      clamp({
        ...crop,
        x: start.startX + (event.clientX - start.x) / size,
        y: start.startY + (event.clientY - start.y) / size,
      }),
    );
  }
  function onStageKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-step, 0),
      ArrowRight: () => move(step, 0),
      ArrowUp: () => move(0, -step),
      ArrowDown: () => move(0, step),
      '+': () => zoomTo((crop?.zoom ?? 1) + 0.1),
      '=': () => zoomTo((crop?.zoom ?? 1) + 0.1),
      '-': () => zoomTo((crop?.zoom ?? 1) - 0.1),
    };
    const run = keys[event.key];
    if (run) {
      event.preventDefault();
      run();
    }
  }

  // Draws the square the person framed, at 1024 pixels, and returns it as WebP (or PNG where the browser cannot).
  async function render(c: Crop) {
    const canvas = document.createElement('canvas');
    canvas.width = outputSide;
    canvas.height = outputSide;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas');
    const { width, height } = c.bitmap;
    const scale = Math.max(outputSide / width, outputSide / height) * c.zoom;
    const drawnW = width * scale,
      drawnH = height * scale;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      c.bitmap,
      (outputSide - drawnW) / 2 + c.x * outputSide,
      (outputSide - drawnH) / 2 + c.y * outputSide,
      drawnW,
      drawnH,
    );
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('encode'))),
        'image/webp',
        0.9,
      ),
    );
  }

  // One command id per decision: a retry after a lost answer sends the same id and the same bytes.
  function send(commandId: string, blob: Blob, expected: number) {
    return new Promise<{ status: number; body: Record<string, unknown> | null }>((resolve) => {
      const request = new XMLHttpRequest();
      request.open('POST', pictureEndpoint);
      request.responseType = 'json';
      request.setRequestHeader('content-type', blob.type);
      request.setRequestHeader('x-command-id', commandId);
      request.setRequestHeader('x-expected-version', String(expected));
      for (const [name, value] of Object.entries(sessionHeaders(subject, issuer)))
        request.setRequestHeader(name, value);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
      };
      request.onload = () => resolve({ status: request.status, body: request.response });
      request.onerror = () => resolve({ status: 0, body: null });
      request.ontimeout = () => resolve({ status: 0, body: null });
      request.timeout = 120000;
      request.send(blob);
    });
  }

  async function upload() {
    if (!crop || !view) return;
    setBusy(true);
    setProblem(null);
    setStatus('');
    setProgress(0);
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), slowAfterMs);
    try {
      if (!pending.current)
        pending.current = { commandId: crypto.randomUUID(), blob: await render(crop) };
      const { status: code, body } = await send(
        pending.current.commandId,
        pending.current.blob,
        view.currentVersion,
      );
      if (code === 200 && body) {
        pending.current = null;
        publish(body as unknown as View);
        setCrop(null);
        setStatus(words.saved);
        window.setTimeout(() => changeButton.current?.focus(), 0);
        return;
      }
      if (code === 0) return setProblem(words.offline);
      // A refused picture will not pass on retry, so it is dropped; a stale screen loads the latest first.
      pending.current = null;
      if (body?.code === 'stale') await reload();
      setProblem(wordsFor(body?.code));
    } catch {
      setProblem(words.unreadable);
    } finally {
      window.clearTimeout(timer);
      setBusy(false);
      setProgress(null);
      setSlow(false);
    }
  }

  async function remove() {
    if (!view) return;
    setBusy(true);
    setProblem(null);
    setStatus('');
    try {
      const response = await fetch(pictureEndpoint, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', ...sessionHeaders(subject, issuer) },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          expectedVersion: view.currentVersion,
        }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok && body) {
        publish(body as unknown as View);
        setStatus(words.removed);
        setAskRemove(false);
        return;
      }
      if (body?.code === 'stale') await reload();
      setProblem(wordsFor(body?.code));
      setAskRemove(false);
    } catch {
      setProblem(words.offline);
      setAskRemove(false);
    } finally {
      setBusy(false);
    }
  }

  const picture = view?.picture ? view.currentVersion : null;
  const face =
    picture !== null ? (
      // eslint-disable-next-line @next/next/no-img-element -- a private, session-checked image; no optimiser may fetch it
      <img
        className="ux-picture-face"
        src={pictureSource(picture, 'large')}
        alt="Your profile picture"
      />
    ) : (
      <span className="ux-picture-face ux-picture-initials" aria-hidden="true">
        {initials || '?'}
      </span>
    );
  const cropStyle = crop
    ? (() => {
        const { width, height } = crop.bitmap;
        const cover = Math.max(1 / width, 1 / height) * crop.zoom;
        return {
          inlineSize: `${width * cover * 100}%`,
          blockSize: `${height * cover * 100}%`,
          insetInlineStart: `${(1 - width * cover) * 50 + crop.x * 100}%`,
          insetBlockStart: `${(1 - height * cover) * 50 + crop.y * 100}%`,
        };
      })()
    : undefined;

  return (
    <div className="ux-picture-row" data-section="picture" aria-busy={busy || load === 'loading'}>
      <h3 id="profile-picture-heading">Profile Picture</h3>
      {load === 'loading' && (
        <p role="status" className="ux-picture-line">
          {words.loading}
        </p>
      )}
      {load === 'missing' && <p className="ux-picture-line">{words.missing}</p>}
      {load === 'failed' && (
        <div role="alert" className="ux-picture-line">
          <p>{words.readFailed}</p>
          <button type="button" className="button button-secondary" onClick={() => void reload()}>
            Try Again
          </button>
        </div>
      )}
      {load === 'ready' && (
        <>
          <div className="ux-picture-current">
            {face}
            <div>
              <p>{picture === null ? words.empty : words.who}</p>
              {picture === null && <p className="ux-picture-hint">{words.who}</p>}
            </div>
          </div>
          <div
            className="ux-picture-drop"
            data-dragging={dragging || undefined}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void choose(event.dataTransfer.files[0]);
            }}
          >
            <p className="ux-picture-hint" id="profile-picture-rules">
              Drop a picture here, or choose one. {words.rules}
            </p>
            <div className="ux-account-actions ux-picture-actions">
              <button
                ref={changeButton}
                type="button"
                className="button button-secondary"
                disabled={busy}
                aria-describedby="profile-picture-rules"
                onClick={() => fileInput.current?.click()}
              >
                {picture === null ? 'Choose a Picture' : 'Change Picture'}
              </button>
              {camera && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => cameraInput.current?.click()}
                >
                  Take a Photo
                </button>
              )}
              {picture !== null && (
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => setAskRemove(true)}
                >
                  Remove Picture
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={accepted.join(',')}
            className="ux-picture-input"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <input
            ref={cameraInput}
            type="file"
            accept={accepted.join(',')}
            capture="user"
            className="ux-picture-input"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void choose(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </>
      )}
      <div role="alert" className="ux-picture-line">
        {problem && !crop && <p data-testid="profile-picture-problem">{problem}</p>}
      </div>
      <div role="status" aria-live="polite" className="ux-picture-line">
        {status && <p>{status}</p>}
      </div>
      <Dialog
        open={crop !== null}
        locked={busy}
        onClose={() => {
          setCrop(null);
          pending.current = null;
        }}
        title="Frame Your Picture"
        returnFocusTo={() => changeButton.current}
      >
        {crop && (
          <div className="ux-picture-editor">
            <div
              ref={stage}
              className="ux-picture-stage"
              role="group"
              tabIndex={0}
              aria-label="Picture position. Drag, or use the arrow keys to move and plus or minus to zoom."
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={onStageKey}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
              <img
                src={crop.url}
                alt=""
                className="ux-picture-source"
                style={cropStyle}
                draggable={false}
              />
              <span className="ux-picture-mask" aria-hidden="true" />
            </div>
            <label className="field" htmlFor="profile-picture-zoom">
              Zoom
              <input
                id="profile-picture-zoom"
                type="range"
                min={1}
                max={4}
                step={0.05}
                value={crop.zoom}
                disabled={busy}
                onChange={(event) => zoomTo(Number(event.target.value))}
              />
            </label>
            <p className="ux-picture-hint">This circle is how your picture will look.</p>
            {progress !== null && (
              <div className="ux-picture-progress" role="status" aria-live="polite">
                <progress max={100} value={progress} aria-label="Upload progress">
                  {progress}%
                </progress>
                <p>{progress < 100 ? `Uploading... ${progress}%` : 'Checking your picture...'}</p>
                {slow && <p>{words.slow}</p>}
              </div>
            )}
            {problem && (
              <p role="alert" className="ux-picture-problem">
                {problem}
              </p>
            )}
            <div className="ux-dialog-actions">
              <button
                type="button"
                className="primary-link"
                disabled={busy}
                onClick={() => void upload()}
              >
                {busy ? 'Saving...' : 'Save Picture'}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setCrop(null);
                  pending.current = null;
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        open={askRemove}
        locked={busy}
        onClose={() => setAskRemove(false)}
        title="Remove Your Picture?"
        returnFocusTo={() => changeButton.current}
      >
        <p>Your initials will be shown instead. The stored picture is deleted.</p>
        <div className="ux-dialog-actions">
          <button
            type="button"
            className="primary-link"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? 'Removing...' : 'Remove Picture'}
          </button>
          <button
            type="button"
            className="button button-secondary"
            data-autofocus=""
            disabled={busy}
            onClick={() => setAskRemove(false)}
          >
            Keep Picture
          </button>
        </div>
      </Dialog>
    </div>
  );
}
