import { useEffect, useState } from 'react';

// UTC, not local: the masthead is documented as a UTC timestamp and shows
// no zone marker, so local time would silently lie outside UTC+0.
function formatStamp(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yy}.${mm}.${dd}/${hh}:${mi}:${ss}`;
}

/**
 * The HUD masthead — system banner for the operative terminal.
 * Shows the brand sigil, a live UTC timestamp, and channel info.
 */
export function TitleBlock() {
  const [stamp, setStamp] = useState(() => formatStamp(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => {
      setStamp(formatStamp(new Date()));
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  return (
    <header className="masthead" aria-label="System banner">
      <div className="masthead__brand">
        <span className="masthead__sigil">
          QRCODR<span>//</span>
        </span>
        <span className="masthead__tagline">Operative // QR forge</span>
      </div>
      <div />
      <div className="masthead__channel" aria-label="System status">
        <span className="masthead__chunk" data-testid="title-date">
          <strong>{stamp}</strong>
        </span>
        <span className="masthead__chunk">
          <span className="masthead__pulse" aria-hidden="true" />
          <span className="masthead__live">Live</span>
        </span>
      </div>
    </header>
  );
}
