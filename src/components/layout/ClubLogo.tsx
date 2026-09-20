import logoSvg from "@/assets/logo.svg?raw";

interface ClubLogoProps {
  className?: string;
  height?: number;
  /** Always render the white logo (e.g. header nav on dark backdrop). */
  tone?: "adaptive" | "white";
}

/** Port of the club website `src/components/ui/ClubLogo.astro`. */
export function ClubLogo({
  className = "",
  height = 32,
  tone = "adaptive",
}: ClubLogoProps) {
  const wrapClass = [
    "club-logo-wrap",
    tone === "white" && "club-logo-wrap--white",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const logo = logoSvg.replace(
    "<svg ",
    `<svg class="club-logo" style="--logo-height: ${height}px" `
  );

  return <span className={wrapClass} dangerouslySetInnerHTML={{ __html: logo }} />;
}
