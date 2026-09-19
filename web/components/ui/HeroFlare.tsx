"use client";

export function HeroFlare() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Central bloom */}
      <div
        className="absolute"
        style={{
          left: "55%",
          top: "10%",
          width: 400,
          height: 600,
          background:
            "radial-gradient(circle, rgba(255,232,197,0.4) 0%, rgba(245,73,0,0.15) 30%, transparent 60%)",
          animation: "flare-pulse 5s ease-in-out infinite",
        }}
      />

      {/* Narrow beam */}
      <div
        className="absolute"
        style={{
          left: "60%",
          top: 0,
          width: 3,
          height: "100%",
          background:
            "linear-gradient(180deg, transparent, rgba(255,232,197,0.7) 50%, transparent)",
          filter: "blur(20px)",
          opacity: 0.6,
        }}
      />

      {/* Wide beam */}
      <div
        className="absolute"
        style={{
          left: "59%",
          top: 0,
          width: 40,
          height: "100%",
          background:
            "linear-gradient(180deg, transparent 10%, rgba(255,232,197,0.3) 50%, transparent 90%)",
          filter: "blur(60px)",
          opacity: 0.4,
        }}
      />

      {/* Angled ray 1 */}
      <div
        className="absolute"
        style={{
          left: "58%",
          top: 0,
          width: 2,
          height: "120%",
          background:
            "linear-gradient(180deg, transparent 20%, rgba(245,73,0,0.3) 50%, transparent 80%)",
          filter: "blur(15px)",
          transform: "rotate(7deg)",
          transformOrigin: "top center",
          opacity: 0.3,
        }}
      />

      {/* Angled ray 2 */}
      <div
        className="absolute"
        style={{
          left: "62%",
          top: 0,
          width: 2,
          height: "120%",
          background:
            "linear-gradient(180deg, transparent 20%, rgba(245,73,0,0.25) 50%, transparent 80%)",
          filter: "blur(12px)",
          transform: "rotate(-5deg)",
          transformOrigin: "top center",
          opacity: 0.25,
        }}
      />
    </div>
  );
}
