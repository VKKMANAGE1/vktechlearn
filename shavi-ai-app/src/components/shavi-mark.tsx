export function ShaviMark({
  className = "",
  text = "ShâVì Ai",
}: {
  className?: string;
  text?: string;
}) {
  return (
    <span aria-label={text} className={`shavi-mark ${className}`} role="img">
      <span className="mark-base">{text}</span>
      <span aria-hidden className="mark-glitch mark-glitch-a">
        {text}
      </span>
      <span aria-hidden className="mark-glitch mark-glitch-b">
        {text}
      </span>
      <span aria-hidden className="mark-scan" />
    </span>
  );
}
