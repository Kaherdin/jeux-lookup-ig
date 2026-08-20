/** @type {import('next').NextConfig} */
const nextConfig = {
  // images Steam servies via <img> classique → pas de config remotePatterns nécessaire
  experimental: {
    // Cache de route côté navigateur : revenir sur une liste déjà vue, changer de
    // liste ou faire « précédent » se fait sans aucune requête pendant 5 minutes.
    staleTimes: { dynamic: 300, static: 600 },
  },
};
export default nextConfig;
