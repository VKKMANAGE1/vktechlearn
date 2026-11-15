export function ShaviMark({
  className = "",
  text = "ShâVì Ai",
  emblem = true,
}: {
  className?: string;
  text?: string;
  emblem?: boolean;
}) {
  const [first, ...rest] = text.split(" ");
  const accent = rest.join(" ");

  return (
    <span aria-label={text} className={`shavi-logo ${className}`} role="img">
      {emblem && (
        <span aria-hidden className="logo-emblem">
          <span className="emblem-hex" />
          <span className="emblem-ring" />
          <span className="emblem-glyph">S</span>
        </span>
      )}
      <span aria-hidden className="logo-word">
        <span className="logo-base">{first}</span>
        {accent && <span className="logo-accent"> {accent}</span>}
      </span>
    </span>
  );
}
