export const metadata = { title: 'Contact' };

export default function ContactPage() {
  return (
    <form>
      <h1>Contactez-nous</h1>
      <label htmlFor="name">Votre nom</label>
      <input id="name" name="name" placeholder="Jean Dupont" />
      <label htmlFor="email">Votre e-mail</label>
      <input id="email" name="email" type="email" placeholder="vous@exemple.fr" title="Adresse e-mail valide" />
      <textarea name="message" placeholder="Écrivez votre message ici" />
      <button type="submit">Envoyer</button>
    </form>
  );
}
