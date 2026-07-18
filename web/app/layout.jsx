import "./globals.css";

export const metadata = {
  title: "🎮 Mes jeux à jouer",
  description: "Backlog de jeux collectés depuis Instagram, enrichi via Steam / IGDB / ITAD.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
