interface Props {
  onNew: () => void;
  onOpen: () => void;
}

function Home({ onNew, onOpen }: Props) {
  return (
    <div className="home">
      <div className="home-center">
        <h1 className="wordmark">Minutes</h1>
        <p className="tagline">Meeting notes that never leave this device.</p>
        <button className="btn-primary" onClick={onNew}>
          New conversation
        </button>
        <button className="btn-quiet" onClick={onOpen}>
          Open a saved conversation…
        </button>
      </div>
      <footer className="local-badge">
        <span className="dot-local" aria-hidden="true" />
        100% local — no audio ever leaves this device.
      </footer>
    </div>
  );
}

export default Home;
