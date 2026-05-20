import { useEffect, useState } from 'react';

const NODE_ID = 'NODE-77A';
const CHANNEL = 'CH·02';

function formatStamp(d: Date): string {
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yy}.${mm}.${dd}/${hh}:${mi}:${ss}`;
}

/**
 * The HUD masthead — system banner for the operative terminal.
 * Shows the brand sigil, a live UTC-style timestamp, and channel info.
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
        <span className="masthead__chunk">
          Node <strong>{NODE_ID}</strong>
        </span>
        <span className="masthead__chunk">
          Chan <strong>{CHANNEL}</strong>
        </span>
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
