import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata: Metadata = {
  title: 'Atelier Lumière',
  description: 'Des luminaires artisanaux fabriqués en France.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Header />
        <main>{children}</main>
        <footer>Tous droits réservés.</footer>
      </body>
    </html>
  );
}
