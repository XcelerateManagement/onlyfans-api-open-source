export function CornerBrackets({
  size = 10,
  color = "var(--theme-accent, #f54900)",
  opacity = 0.5,
}: {
  size?: number;
  color?: string;
  opacity?: number;
}) {
  const style = (
    top: boolean,
    left: boolean,
  ): React.CSSProperties => ({
    position: "absolute",
    width: size,
    height: size,
    pointerEvents: "none",
    ...(top ? { top: -1 } : { bottom: -1 }),
    ...(left ? { left: -1 } : { right: -1 }),
    borderColor: color,
    borderStyle: "solid",
    borderWidth: 0,
    opacity,
    ...(top && left
      ? { borderTopWidth: 2, borderLeftWidth: 2 }
      : top && !left
        ? { borderTopWidth: 2, borderRightWidth: 2 }
        : !top && left
          ? { borderBottomWidth: 2, borderLeftWidth: 2 }
          : { borderBottomWidth: 2, borderRightWidth: 2 }),
  });

  // Purely decorative corner rules. They are empty spans so they produce no
  // accessible node today, but /open-source renders this ~20 times per page and
  // marking the intent explicitly keeps it that way if content is ever added.
  return (
    <>
      <span aria-hidden="true" style={style(true, true)} />
      <span aria-hidden="true" style={style(true, false)} />
      <span aria-hidden="true" style={style(false, true)} />
      <span aria-hidden="true" style={style(false, false)} />
    </>
  );
}
