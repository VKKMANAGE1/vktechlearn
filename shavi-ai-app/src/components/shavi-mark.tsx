export function ShaviMark({
  className = "",
  text = "ShâVì Ai",
}: {
  className?: string;
  text?: string;
}) {
  const [first, ...rest] = text.split(" ");
  const accent = rest.join(" ");

  return (
    <span aria-label={text} className={`shavi-logo ${className}`} role="img">
      <span aria-hidden className="logo-word">
        <span className="logo-base">{first}</span>
        {accent && <span className="logo-accent"> {accent}</span>}
      </span>
    </span>
  );
}
