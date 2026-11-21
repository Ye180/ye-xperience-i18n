import Link from 'next/link';
import { Badge } from '@/components/Badge';
import { Counter } from '@/components/Counter';

export default function HomePage() {
  return (
    <section>
      <h1>Bienvenue chez Atelier Lumière</h1>
      <Badge />
      <p>Nous fabriquons des lampes uniques, à la main, depuis 1998.</p>
      <img src="/logo.svg" alt="Logo de l'atelier" width={48} height={48} />
      <button type="button" aria-label="Ajouter aux favoris">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
        </svg>
        Ajouter aux favoris
      </button>
      {/* i18n-ignore */}
      <p>Ne pas traduire cette ligne.</p>
      <p>
        Code promo : <strong>LUMIERE10</strong>
      </p>
      <Link href="/contact">Nous contacter</Link>
      <Counter />
    </section>
  );
}
