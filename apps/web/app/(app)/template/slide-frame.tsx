/** A slide rendered by /render inside a scaled iframe: the real renderer, never a mock-up. */
export function SlideFrame({
  src,
  title,
  width,
  height,
  scale,
}: {
  src: string;
  title: string;
  width: number;
  height: number;
  scale: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-md border border-subtle bg-app"
      style={{ width: width * scale, height: height * scale }}
    >
      <iframe
        src={src}
        title={title}
        sandbox=""
        loading="lazy"
        width={width}
        height={height}
        className="origin-top-left border-0"
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
