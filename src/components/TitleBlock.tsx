import { useMemo } from 'react';

const DOC_NUMBER = 'DWG·001';
const REVISION = 'REV.A';

function formatToday(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

export function TitleBlock() {
  const date = useMemo(formatToday, []);
  return (
    <header className="title-block" aria-label="Document title block">
      <div className="title-block__cell">
        <span className="title-block__label">DWG</span>
        <span className="title-block__value">{DOC_NUMBER}</span>
      </div>
      <div className="title-block__cell title-block__cell--title">
        <span className="title-block__title">qrcodr</span>
      </div>
      <div className="title-block__cell">
        <span className="title-block__label">Rev</span>
        <span className="title-block__value">{REVISION}</span>
      </div>
      <div className="title-block__cell">
        <span className="title-block__label">Date</span>
        <span className="title-block__value" data-testid="title-date">
          {date}
        </span>
      </div>
      <div className="title-block__cell">
        <span className="title-block__label">Pg</span>
        <span className="title-block__value">1/1</span>
      </div>
    </header>
  );
}
