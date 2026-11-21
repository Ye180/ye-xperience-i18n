import Link from 'next/link';

export function Header() {
  return (
    <header>
      <Link href="/" title="Retour à l'accueil">
        Atelier Lumière
      </Link>
      <nav>
        <Link href="/">Accueil</Link>
        <Link href="/a-propos">À propos</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </header>
  );
}
