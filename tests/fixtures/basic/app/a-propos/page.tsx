async function getYears() {
  return new Date().getFullYear() - 1998;
}

export default async function AboutPage() {
  const years = await getYears();
  return (
    <article>
      <h1>À propos</h1>
      <p>Une petite équipe passionnée par la lumière.</p>
      <p>{years} ans d'expérience</p>
    </article>
  );
}
