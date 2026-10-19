import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  canNext: boolean;
  canPrevious: boolean;
  /** Names the pager for assistive tech: "Session list pages". */
  label: string;
  onNext: () => void;
  onPrevious: () => void;
  /** What sits between the buttons: "Page 2 of 5", or a date span. */
  text: string;
}

/** Previous and next buttons around a text. */
export function Pager({ canNext, canPrevious, label, onNext, onPrevious, text }: Props) {
  return (
    <nav aria-label={label} className="pager">
      <button aria-label="Previous page" className="icon-button" disabled={!canPrevious} onClick={onPrevious} type="button">
        <ChevronLeft aria-hidden="true" size={18} />
      </button>
      <span>{text}</span>
      <button aria-label="Next page" className="icon-button" disabled={!canNext} onClick={onNext} type="button">
        <ChevronRight aria-hidden="true" size={18} />
      </button>
    </nav>
  );
}
