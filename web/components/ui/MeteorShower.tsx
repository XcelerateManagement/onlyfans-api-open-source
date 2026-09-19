"use client";

const meteors = [
  { width: 120, top: "8%", left: "75%", delay: "0s", duration: "1.4s" },
  { width: 90, top: "22%", left: "85%", delay: "2.5s", duration: "1.2s" },
  { width: 140, top: "35%", left: "65%", delay: "4.8s", duration: "1.6s" },
  { width: 80, top: "50%", left: "90%", delay: "1.5s", duration: "1.1s" },
  { width: 110, top: "15%", left: "55%", delay: "6.2s", duration: "1.5s" },
  { width: 100, top: "42%", left: "78%", delay: "3.3s", duration: "1.3s" },
  { width: 70, top: "60%", left: "70%", delay: "5.5s", duration: "1.0s" },
  { width: 130, top: "28%", left: "60%", delay: "7.0s", duration: "1.7s" },
];

export function MeteorShower() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {meteors.map((m, i) => (
        <div
          key={i}
          className={`absolute will-change-transform ${i >= 4 ? "hidden sm:block" : ""}`}
          style={{
            width: m.width,
            height: 1,
            top: m.top,
            left: m.left,
            background:
              "linear-gradient(270deg, rgba(255,255,255,0.6), transparent)",
            animation: `meteor-fall ${m.duration} linear ${m.delay} infinite`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  );
}
