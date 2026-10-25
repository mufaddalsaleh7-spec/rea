import { Link } from "../link.jsx";
import { Page } from "../components.jsx";

export default function NotFound({ route }) {
  return (
    <Page title="No such screen" subtitle={`#/${route.segments.join("/")}`}>
      <p>
        That address is not part of TallyCraft. <Link to="gateway">Go to the gateway</Link>.
      </p>
    </Page>
  );
}
