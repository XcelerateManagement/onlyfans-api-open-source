import {
  LockGlyph,
  CubeGlyph,
  BoltGlyph,
  ServerGlyph,
  CloudGlyph,
  CodeGlyph,
} from "@/components/open-source/icons";

/**
 * "What open source actually buys you" — six connected boxes.
 *
 * Every claim here is one the rest of the page or the repo can back up. No
 * generic open-source poetry: each box names a concrete consequence for an
 * agency owner.
 *
 * Connector rails are drawn with absolutely-positioned spans pinned to the
 * grid gap and shown only at `lg`, where the three-column layout actually
 * exists. They are decorative and `aria-hidden`.
 */

const POWERS = [
  {
    Icon: LockGlyph,
    title: "Auditable, not promised",
    body: "Every line that touches a creator credential or a fan message is readable. You are not trusting a privacy policy — you are reading the code that enforces it.",
  },
  {
    Icon: CubeGlyph,
    title: "No lock-in, ever",
    body: "If we raise prices, get acquired or shut down, your install keeps running. The licence is irrevocable, and the fork you hold is a complete product, not a client.",
  },
  {
    Icon: ServerGlyph,
    title: "Your disk, your jurisdiction",
    body: "Messages, subscribers, earnings and sessions live on hardware you chose, in a country you chose, under a retention policy you wrote.",
  },
  {
    Icon: BoltGlyph,
    title: "Fixes land in the open",
    body: "When a platform rotates its signing headers, the patch is public the moment it exists. You pull it on your schedule instead of waiting for a vendor release note.",
  },
  {
    Icon: CodeGlyph,
    title: "Modify anything",
    body: "Add an endpoint, change the polling cadence, bolt on your own automations. You are not filing a feature request and hoping — you are editing the source.",
  },
  {
    Icon: CloudGlyph,
    title: "An exit that runs both ways",
    body: "Start self-hosted and move to the cloud, or leave the cloud and take the code. Same schema, same API, same dashboard — the decision is never permanent.",
  },
];

export function PowerGrid() {
  return (
    <div className="relative">
      {/* Connector rails: two vertical lines sitting in the column gaps, and a
          horizontal one along the row gap. lg only — below that the grid
          collapses and the rails would point at nothing. */}
      <div aria-hidden="true" className="pointer-events-none hidden lg:block">
        <span className="absolute top-0 bottom-0 left-1/3 -ml-2 w-px bg-gradient-to-b from-transparent via-[#f54900]/30 to-transparent" />
        <span className="absolute top-0 bottom-0 left-2/3 -ml-2 w-px bg-gradient-to-b from-transparent via-[#f54900]/30 to-transparent" />
        <span className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[#f54900]/30 to-transparent" />
      </div>

      <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
        {POWERS.map(({ Icon, title, body }) => (
          <div
            key={title}
            className="group rounded-2xl bg-[#100b08]/80 border border-[#f54900]/25 p-6 transition-colors hover:border-[#f54900]/60 hover:shadow-[0_0_30px_-8px_rgba(245,73,0,0.45)]"
          >
            <span className="grid place-items-center w-11 h-11 rounded-lg border border-[#f54900]/45 bg-[#f54900]/[0.08] text-[#f54900] mb-4">
              <Icon className="w-[18px] h-[18px]" />
            </span>
            <h3 className="text-base font-semibold text-foreground mb-2">
              {title}
            </h3>
            <p className="text-sm text-default-400 leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
