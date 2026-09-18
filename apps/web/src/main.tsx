import React, {
  useState,
  lazy,
  Suspense,
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  AudioLines,
  Compass,
  Search,
  Library,
  Clock3,
  ChartNoAxesCombined,
  Settings2,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Play,
  Music2,
  Disc3,
  Users,
  LogOut,
  X,
  Headphones,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
  ArrowUp,
  ArrowDown,
  Globe,
  Lock,
  Upload,
  Network,
  Database,
  ShieldCheck,
} from "lucide-react";
import { type Song, type User } from "@resonance/shared";
import { api, client, useApi, refresh } from "./api";
import {
  PlayerProvider,
  PlayerRail,
  PlayerBar,
  usePlayer,
  duration,
} from "./player";
const Admin = lazy(() => import("./admin").then((m) => ({ default: m.Admin })));
import "./styles.css";
const Auth = createContext<{ user: User | null; signIn: () => void }>({
  user: null,
  signIn: () => {},
});
export const useAuth = () => useContext(Auth);
export function Message({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      {children}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function Cover({
  title,
  index = 0,
  small = false,
}: {
  title: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <div className={(small ? "mini-cover" : "cover") + " art-" + (index % 8)}>
      <div className="cover-orbit" />
      <span className="cover-type">
        {title.split(" ").slice(0, 3).join(" ")}
      </span>
      <span className="cover-bottom">RESONANCE / SELECTS</span>
    </div>
  );
}
export function SongCards({ songs }: { songs: Song[] }) {
  const p = usePlayer();
  return (
    <div className="song-grid">
      {songs.map((s, i) => (
        <article className="song-card" key={s.songId}>
          <button
            className="cover-button"
            aria-label={"Play " + s.title}
            onClick={() => p.play(songs, i)}
          >
            <Cover title={s.title} index={i} />
            <span className="card-play">
              <Play size={18} fill="currentColor" />
            </span>
          </button>
          <h3>{s.title}</h3>
          <Link to={"/artists/" + s.artists?.[0]?.artistId}>
            {s.artists?.map((a) => a.name).join(", ")}
          </Link>
          {s.reason && <small className="reason">{s.reason}</small>}
        </article>
      ))}
    </div>
  );
}
export function SongTable({
  songs,
  playlistId,
  onRemove,
  onMove,
}: {
  songs: Song[];
  playlistId?: string;
  onRemove?: (i: number) => void;
  onMove?: (i: number, d: number) => void;
}) {
  const p = usePlayer(),
    { user, signIn } = useAuth();
  const [adding, setAdding] = useState<Song | null>(null),
    [notice, setNotice] = useState("");
  const lists = useApi<any[]>("/playlists", !!user);
  const add = async (id: string) => {
    try {
      const pl = await api("/playlists/" + id);
      await api("/playlists/" + id, "PUT", {
        ...pl,
        tracks: [
          ...pl.tracks.map(({ song, unavailable, ...t }: any) => t),
          {
            entryId: crypto.randomUUID(),
            songId: adding!.songId,
            position: pl.tracks.length + 1,
            addedAt: new Date().toISOString(),
          },
        ],
      });
      setAdding(null);
      setNotice("Added to playlist");
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  return (
    <>
      {notice && <Message>{notice}</Message>}
      <div className="track-table">
        <div className="track-row table-head">
          <span>#</span>
          <span>TITLE</span>
          <span>ALBUM</span>
          <span>
            <Clock3 size={13} />
          </span>
          <span />
        </div>
        {songs.map((s, i) => (
          <div
            className={
              "track-row " + (s.status !== "active" ? "unavailable" : "")
            }
            key={s.songId + i}
          >
            <button
              className="row-play"
              aria-label={"Play " + s.title}
              disabled={s.status !== "active"}
              onClick={() =>
                p.play(
                  songs.filter((x) => x.status === "active"),
                  songs.slice(0, i).filter((x) => x.status === "active").length,
                  playlistId,
                )
              }
            >
              <span>{String(i + 1).padStart(2, "0")}</span>
              <Play size={14} />
            </button>
            <div className="track-info">
              <Cover title={s.title} index={i} small />
              <div>
                <strong>{s.title}</strong>
                <small>
                  <Link to={"/artists/" + s.artists?.[0]?.artistId}>
                    {s.artists?.map((a) => a.name).join(", ") || "Unavailable"}
                  </Link>
                  {s.status !== "active" && " · Retired"}
                </small>
              </div>
            </div>
            <Link className="album-cell" to={"/albums/" + s.albumId}>
              {s.album?.title || "—"}
            </Link>
            <span className="muted">{duration(s.durationSec)}</span>
            <div className="row-actions">
              {onMove && (
                <>
                  <button
                    aria-label={"Move " + s.title + " up"}
                    disabled={i === 0}
                    onClick={() => onMove(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label={"Move " + s.title + " down"}
                    disabled={i === songs.length - 1}
                    onClick={() => onMove(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </button>
                </>
              )}
              {onRemove ? (
                <button
                  aria-label={"Remove " + s.title}
                  onClick={() => onRemove(i)}
                >
                  <X size={16} />
                </button>
              ) : (
                <button
                  aria-label={"Add " + s.title + " to playlist"}
                  onClick={() => (user ? setAdding(s) : signIn())}
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!songs.length && (
          <div className="empty">
            <Music2 />
            <h3>No tracks here yet</h3>
            <p>Explore the catalog and add something you love.</p>
          </div>
        )}
      </div>
      {adding && (
        <div className="modal-backdrop">
          <Modal close={() => setAdding(null)} titleId="playlist-dialog-title">
            <button
              className="modal-close"
              onClick={() => setAdding(null)}
              aria-label="Close"
            >
              <X />
            </button>
            <h2 id="playlist-dialog-title">Add to playlist</h2>
            <p>{adding.title}</p>
            {lists.data
              ?.filter((x) => x.ownerUserId === user?.userId)
              .map((x) => (
                <button
                  className="select-list"
                  onClick={() => add(x.playlistId)}
                  key={x.playlistId}
                >
                  <Library size={20} />
                  {x.name}
                  <Plus size={16} />
                </button>
              ))}
            <Link
              className="button secondary"
              to="/library"
              onClick={() => setAdding(null)}
            >
              Create a playlist
            </Link>
          </Modal>
        </div>
      )}
    </>
  );
}
function Home() {
  const { user } = useAuth(),
    songs = useApi("/songs?limit=15"),
    rec = useApi("/recommendations", !!user),
    genres = useApi<any[]>("/genres"),
    p = usePlayer();
  const [genre, setGenre] = useState("");
  const filtered = genre
    ? (songs.data?.items || []).filter((s: Song) => s.genreIds.includes(genre))
    : songs.data?.items || [];
  const first = filtered.slice(0, 4);
  return (
    <>
      <div className="greeting">
        <span>YOUR DAILY SOUNDTRACK</span>
        <span>
          <span className="live-dot" /> A little more you, every day
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-label">
            <span /> CURATED FOR THE CURIOUS
          </div>
          <h1>
            Find your
            <br />
            <em>frequency.</em>
          </h1>
          <p>
            Old favorites. New obsessions.
            <br />A world of music, a little closer to you.
          </p>
          <button
            className="button primary"
            onClick={() => p.play(songs.data?.items || [])}
          >
            <Play size={16} fill="currentColor" /> Start listening
          </button>
          <Link to="/search" className="hero-link">
            Explore the catalog <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="vinyl">
            <div className="vinyl-label">
              <AudioLines size={36} />
              <span>RESONANCE</span>
              <i />
            </div>
          </div>
          <div className="art-caption">
            <span>
              GOOD MUSIC.
              <br />
              NO WRONG TURNS.
            </span>
            <span>
              VOL.
              <br />
              001
            </span>
          </div>
        </div>
      </section>
      <div className="genre-strip">
        <button
          className={!genre ? "selected" : ""}
          onClick={() => setGenre("")}
        >
          All music
        </button>
        {genres.data?.slice(0, 6).map((g) => (
          <button
            key={g.genreId}
            className={genre === g.genreId ? "selected" : ""}
            onClick={() => setGenre(g.genreId)}
          >
            {g.name}
          </button>
        ))}
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">A FRESH PERSPECTIVE</span>
          <h2>Made for your moment</h2>
        </div>
        <Link to="/search">
          View all <ArrowRight size={15} />
        </Link>
      </div>
      {songs.error ? (
        <Message>{songs.error.message}</Message>
      ) : songs.isLoading ? (
        <div className="skeleton-grid">
          {[1, 2, 3, 4].map((i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : (
        <SongCards songs={first} />
      )}
      <div className="section-heading spaced">
        <div>
          <span className="eyebrow">KEEP THE GOOD ONES CLOSE</span>
          <h2>{user ? "A few discoveries for you" : "In the rotation"}</h2>
        </div>
        <span className="subtle-pill">
          <Headphones size={13} />{" "}
          {user ? "Your next listen" : "Worth a listen"}
        </span>
      </div>
      <SongTable
        songs={(rec.data?.items?.length ? rec.data.items : filtered).slice(
          0,
          5,
        )}
      />
      <div className="editorial-note">
        <AudioLines size={22} />
        <span>
          Music connects the dots. <strong>You make the discoveries.</strong>
        </span>
        <span>RESONANCE</span>
      </div>
    </>
  );
}
function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "",
    genre = params.get("genre") || "",
    language = params.get("language") || "",
    year = params.get("year") || "",
    page = +(params.get("page") || 1);
  const genres = useApi<any[]>("/genres");
  const result = useApi("/songs?" + params.toString());
  const set = (key: string, value: string) => {
    const n = new URLSearchParams(params);
    value ? n.set(key, value) : n.delete(key);
    n.delete("page");
    setParams(n);
  };
  return (
    <>
      <PageTitle
        eyebrow="FOLLOW YOUR CURIOSITY"
        title="Explore the catalog"
        description="A song, an artist, a whole new favorite."
      />
      <div className="search-box">
        <Search size={20} />
        <input
          aria-label="Search catalog"
          placeholder="Search song, artist, or album…"
          value={q}
          onChange={(e) => set("q", e.target.value)}
        />
      </div>
      <div className="filters">
        <select
          aria-label="Genre"
          value={genre}
          onChange={(e) => set("genre", e.target.value)}
        >
          <option value="">All genres</option>
          {genres.data?.map((g) => (
            <option key={g.genreId} value={g.genreId}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Language"
          value={language}
          onChange={(e) => set("language", e.target.value)}
        >
          <option value="">All languages</option>
          {["English", "Hindi", "Spanish", "Korean"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <input
          aria-label="Release year"
          placeholder="Release year"
          type="number"
          min="1900"
          max="2100"
          value={year}
          onChange={(e) => set("year", e.target.value)}
        />
        <span>{result.data?.total || 0} tracks</span>
      </div>
      {result.error ? (
        <Message>{result.error.message}</Message>
      ) : (
        <SongTable songs={result.data?.items || []} />
      )}
      <div className="pagination">
        <button
          disabled={page <= 1}
          onClick={() => {
            params.set("page", String(page - 1));
            setParams(params);
          }}
        >
          <ChevronLeft size={16} />
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={page * 24 >= (result.data?.total || 0)}
          onClick={() => {
            params.set("page", String(page + 1));
            setParams(params);
          }}
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </>
  );
}
function LibraryPage() {
  const { user, signIn } = useAuth(),
    nav = useNavigate();
  const lists = useApi<any[]>("/playlists", !!user),
    [name, setName] = useState(""),
    [message, setMessage] = useState("");
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await api("/playlists", "POST", {
        name,
        visibility: "private",
      });
      refresh();
      nav("/playlists/" + p.playlistId);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="YOUR MUSIC, YOUR WAY"
        title="Your library"
        description="A place for every version of you."
      />
      {!user ? (
        <button className="button primary" onClick={signIn}>
          Sign in to make a playlist
        </button>
      ) : (
        <>
          <form onSubmit={create} className="inline-form">
            <input
              required
              aria-label="New playlist name"
              placeholder="Name your next playlist…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="button primary">
              <Plus size={17} />
              Create playlist
            </button>
          </form>
          {message && <Message>{message}</Message>}
          <div className="section-heading">
            <h2>Made by you</h2>
            <span>
              {lists.data?.filter((x) => x.ownerUserId === user.userId)
                .length || 0}{" "}
              playlists
            </span>
          </div>
          <PlaylistCards
            lists={
              lists.data?.filter((x) => x.ownerUserId === user.userId) || []
            }
          />
          <div className="section-heading spaced">
            <h2>From the community</h2>
            <Globe size={18} />
          </div>
          <PlaylistCards
            lists={
              lists.data?.filter((x) => x.ownerUserId !== user.userId) || []
            }
          />
        </>
      )}
    </>
  );
}
function PlaylistCards({ lists }: { lists: any[] }) {
  return (
    <div className="song-grid">
      {lists.map((p, i) => (
        <Link
          className="song-card"
          to={"/playlists/" + p.playlistId}
          key={p.playlistId}
        >
          <Cover title={p.name} index={i + 2} />
          <h3>{p.name}</h3>
          <p>
            {p.tracks.length} tracks · {p.visibility}
          </p>
        </Link>
      ))}
    </div>
  );
}
function PlaylistPage() {
  const { id } = useParams(),
    { user } = useAuth(),
    p = useApi("/playlists/" + id),
    player = usePlayer(),
    nav = useNavigate();
  const [message, setMessage] = useState(""),
    [editing, setEditing] = useState(false);
  const own = p.data?.ownerUserId === user?.userId;
  const save = async (change: any) => {
    try {
      await api("/playlists/" + id, "PUT", {
        ...p.data,
        tracks: p.data.tracks.map(({ song, unavailable, ...t }: any) => t),
        ...change,
      });
      await refresh();
      setEditing(false);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  if (p.error) return <Message>{p.error.message}</Message>;
  if (!p.data) return <Message>Loading playlist…</Message>;
  return (
    <>
      <section className="detail-hero">
        <Cover title={p.data.name} index={3} />
        <div>
          <span className="eyebrow">
            {p.data.visibility === "public" ? (
              <Globe size={12} />
            ) : (
              <Lock size={12} />
            )}{" "}
            {p.data.visibility} PLAYLIST
          </span>
          <h1>{p.data.name}</h1>
          <p>{p.data.description}</p>
          <small>
            {p.data.tracks.length} tracks · {duration(p.data.totalDuration)}{" "}
            total
          </small>
        </div>
      </section>
      <div className="action-line">
        <button
          className="button primary"
          onClick={() =>
            player.play(
              p.data.tracks
                .filter((x: any) => !x.unavailable)
                .map((x: any) => x.song),
              0,
              id,
            )
          }
        >
          <Play size={16} />
          Play playlist
        </button>
        {own && (
          <>
            <button
              className="button secondary"
              onClick={() => setEditing(!editing)}
            >
              <Settings2 size={16} />
              Edit details
            </button>
            <button
              className="icon-button danger"
              aria-label="Delete playlist"
              onClick={async () => {
                if (confirm("Delete this playlist?")) {
                  await api("/playlists/" + id, "DELETE", {
                    version: p.data.version,
                  });
                  refresh();
                  nav("/library");
                }
              }}
            >
              <Trash2 size={18} />
            </button>
          </>
        )}
      </div>
      {editing && (
        <form
          className="form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save({
              name: f.get("name"),
              description: f.get("description"),
              visibility: f.get("visibility"),
            });
          }}
        >
          <label>
            Name
            <input name="name" required defaultValue={p.data.name} />
          </label>
          <label>
            Description
            <input name="description" defaultValue={p.data.description} />
          </label>
          <label>
            Visibility
            <select name="visibility" defaultValue={p.data.visibility}>
              <option>public</option>
              <option>private</option>
            </select>
          </label>
          <button className="button primary">Save changes</button>
        </form>
      )}
      {message && <Message>{message}</Message>}
      <SongTable
        songs={p.data.tracks.map(
          (x: any) =>
            x.song || {
              songId: x.songId,
              title: "Unavailable song",
              status: "retired",
              durationSec: 0,
            },
        )}
        playlistId={id}
        onRemove={
          own
            ? (i) =>
                save({
                  tracks: p.data.tracks
                    .filter((_: any, j: number) => i !== j)
                    .map(({ song, unavailable, ...t }: any, j: number) => ({
                      ...t,
                      position: j + 1,
                    })),
                })
            : undefined
        }
        onMove={
          own
            ? (i, d) => {
                const tracks = p.data.tracks.map(
                  ({ song, unavailable, ...t }: any) => t,
                );
                [tracks[i], tracks[i + d]] = [tracks[i + d], tracks[i]];
                save({
                  tracks: tracks.map((t: any, j: number) => ({
                    ...t,
                    position: j + 1,
                  })),
                });
              }
            : undefined
        }
      />
    </>
  );
}
function EntityPage({ kind }: { kind: "artists" | "albums" }) {
  const { id } = useParams(),
    { user, signIn } = useAuth();
  const info = useApi("/" + kind + "/" + id),
    songs = useApi(
      "/songs?" + (kind === "artists" ? "artistId" : "albumId") + "=" + id,
    ),
    follows = useApi<any[]>("/follows", !!user),
    player = usePlayer();
  const followed = follows.data?.some((x) => x.artistId === id);
  return (
    <>
      {info.error && <Message>{info.error.message}</Message>}
      <section className="detail-hero">
        <Cover
          title={info.data?.name || info.data?.title || "Music"}
          index={5}
        />
        <div>
          <span className="eyebrow">
            {kind === "artists" ? "ARTIST" : "ALBUM"}
          </span>
          <h1>{info.data?.name || info.data?.title}</h1>
          <p>{info.data?.bio || info.data?.releaseDate?.slice(0, 10)}</p>
        </div>
      </section>
      <div className="action-line">
        <button
          className="button primary"
          onClick={() => player.play(songs.data?.items || [])}
        >
          <Play size={16} />
          Play
        </button>
        {kind === "artists" && (
          <button
            className="button secondary"
            onClick={async () => {
              if (!user) return signIn();
              await api("/follows/" + id, followed ? "DELETE" : "PUT");
              refresh();
            }}
          >
            {followed ? <Check size={16} /> : <Plus size={16} />}{" "}
            {followed ? "Following" : "Follow artist"}
          </button>
        )}
      </div>
      <SongTable songs={songs.data?.items || []} />
    </>
  );
}
function HistoryPage() {
  const { user, signIn } = useAuth();
  const [from, setFrom] = useState(""),
    [page, setPage] = useState(1);
  const result = useApi(
    "/history?page=" + page + (from ? "&from=" + from : ""),
    !!user,
  );
  return (
    <>
      <PageTitle
        eyebrow="THE SOUNDTRACK SO FAR"
        title="Recently played"
        description="Your listening history, only for you."
      />
      {!user ? (
        <button className="button primary" onClick={signIn}>
          Sign in to see your history
        </button>
      ) : (
        <>
          <div className="filters">
            <label>
              Since{" "}
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          {result.error && <Message>{result.error.message}</Message>}
          {result.data?.items.map((x: any, i: number) => (
            <div className="history-row" key={x.sessionId}>
              <Cover title={x.song?.title || "?"} index={i} small />
              <div>
                <strong>{x.song?.title || "Unavailable song"}</strong>
                <small>
                  {new Date(x.startedAt).toLocaleString()}
                  {x.synthetic ? " · Demo history" : ""}
                </small>
              </div>
              <span>{duration(x.playedSeconds)} listened</span>
              <span className="subtle-pill">{x.endReason || "playing"}</span>
            </div>
          ))}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * 30 >= result.data?.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </>
  );
}
function StatsPage() {
  const { user, signIn } = useAuth(),
    s = useApi("/summary", !!user);
  const d = s.data?.rows[0] || {};
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE SELF DISCOVERY"
        title="Your listening, in numbers"
        description="Your activity in Resonance. These are not YouTube statistics."
      />
      {!user ? (
        <button className="button primary" onClick={signIn}>
          Sign in to see your statistics
        </button>
      ) : (
        <>
          <div className="stat-grid">
            {[
              ["Minutes listened", Math.round((d.playedSeconds || 0) / 60)],
              ["Qualified plays", d.qualifiedPlays || 0],
              ["Listening sessions", d.sessions || 0],
              [
                "Average coverage",
                Math.round((d.completionRatio || 0) * 100) + "%",
              ],
            ].map(([name, value]) => (
              <div className="stat-card" key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <Message>
            Statistics include finalized sessions. A qualified play means at
            least 30 seconds, or half of a shorter song. Demo accounts include
            synthetic listening history.
          </Message>
        </>
      )}
    </>
  );
}
function Settings() {
  const { user, signIn } = useAuth(),
    genres = useApi<any[]>("/genres");
  const [message, setMessage] = useState("");
  if (!user)
    return (
      <button className="button primary" onClick={signIn}>
        Sign in to manage your profile
      </button>
    );
  return (
    <>
      <PageTitle eyebrow="MAKE IT YOURS" title="Profile & privacy" />
      <form
        className="form-panel"
        key={user.userId}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api("/profile", "PATCH", {
              displayName: f.get("displayName"),
              country: f.get("country"),
              genreIds: f.getAll("genres"),
              recommendationOptIn: f.get("optIn") === "on",
            });
            refresh();
            setMessage("Profile saved");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        <label>
          Display name
          <input name="displayName" defaultValue={user.displayName} required />
        </label>
        <label>
          Country
          <input name="country" defaultValue={user.country} />
        </label>
        <fieldset>
          <legend>Your favorite genres</legend>
          <div className="checkbox-grid">
            {genres.data?.map((g) => (
              <label key={g.genreId}>
                <input
                  type="checkbox"
                  name="genres"
                  value={g.genreId}
                  defaultChecked={user.preferences.genreIds.includes(g.genreId)}
                />
                {g.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="check-label">
          <input
            type="checkbox"
            name="optIn"
            defaultChecked={user.privacy.recommendationOptIn}
          />{" "}
          Participate in personalized recommendations
        </label>
        <p className="muted">
          Your history stays private. Turning this off removes your listening
          and follow connections from the recommendation graph.
        </p>
        <button className="button primary">Save preferences</button>
        {message && <Message>{message}</Message>}
      </form>
      <div className="danger-zone">
        <h3>Delete your account</h3>
        <p>
          Revokes access immediately and removes your data from both databases.
        </p>
        <button
          className="button danger"
          onClick={async () => {
            if (
              confirm(
                "Permanently delete your account, playlists, and listening history?",
              )
            ) {
              await api("/profile", "DELETE");
              refresh();
            }
          }}
        >
          Delete account
        </button>
      </div>
    </>
  );
}
function Modal({
  close,
  titleId,
  children,
}: {
  close: () => void;
  titleId: string;
  children: ReactNode;
}) {
  const element = useRef<HTMLElement>(null),
    onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = element.current!;
    const focusable = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
        ),
      ].filter((x) => x.offsetParent !== null);
    focusable()[0]?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose.current();
      }
      if (e.key === "Tab") {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener("keydown", keydown);
    return () => {
      dialog.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  return (
    <section
      className="modal"
      ref={element}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {children}
    </section>
  );
}
function AuthModal({ close }: { close: () => void }) {
  const [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <Modal close={close} titleId="auth-title">
        <button className="modal-close" aria-label="Close" onClick={close}>
          <X />
        </button>
        <AudioLines className="lime" size={36} />
        <h2 id="auth-title">
          {mode === "login"
            ? "Back to your rhythm."
            : "Find your people. And your music."}
        </h2>
        <p>
          {mode === "login"
            ? "Sign in to pick up where you left off."
            : "Create your free Resonance account."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              await api("/auth/" + mode, "POST", {
                email: f.get("email"),
                password: f.get("password"),
                ...(mode === "register" ? { displayName: f.get("name") } : {}),
              });
              client.removeQueries({
                predicate: (q) => q.queryKey[0] !== "/auth/me",
              });
              await refresh();
              close();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {mode === "register" && (
            <label>
              Display name
              <input required name="name" autoComplete="name" />
            </label>
          )}
          <label>
            Email
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <label>
            Password
            <input
              required
              minLength={12}
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
          {error && <Message>{error}</Message>}
          <button className="button primary full" disabled={busy}>
            {busy
              ? "One moment…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
            <ArrowRight size={16} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login"
            ? "New here? Create an account"
            : "Already a listener? Sign in"}
        </button>
        <div className="demo-hint">
          Local demo: listener@resonance.local
          <br />
          Password: ResonanceDemo!2026
        </div>
      </Modal>
    </div>
  );
}
function Shell() {
  const auth = useApi<{ user: User | null; csrfToken: string }>("/auth/me"),
    user = auth.data?.user || null,
    [modal, setModal] = useState(false),
    nav = useNavigate();
  const lists = useApi<any[]>("/playlists", !!user);
  return (
    <Auth.Provider value={{ user, signIn: () => setModal(true) }}>
      <PlayerProvider user={user} onSignIn={() => setModal(true)}>
        <div className="app-layout">
          <aside className="sidebar">
            <Link to="/" className="brand" aria-label="Resonance home">
              <AudioLines size={28} />
              <span>
                resonance<span className="brand-dot">.</span>
              </span>
            </Link>
            <span className="nav-label">DISCOVER</span>
            <nav>
              <NavLink to="/" end>
                <Compass />
                For you
              </NavLink>
              <NavLink to="/search">
                <Search />
                Explore
              </NavLink>
              <NavLink to="/library">
                <Library />
                Your library
              </NavLink>
            </nav>
            <span className="nav-label">YOUR SPACE</span>
            <nav>
              <NavLink to="/history">
                <Clock3 />
                Recently played
              </NavLink>
              <NavLink to="/stats">
                <ChartNoAxesCombined />
                Listening stats
              </NavLink>
              <NavLink to="/settings">
                <Settings2 />
                Preferences
              </NavLink>
            </nav>
            <div className="sidebar-divider" />
            <div className="playlist-nav-head">
              <span className="nav-label">YOUR PLAYLISTS</span>
              <Link to="/library" aria-label="Create playlist">
                <Plus size={17} />
              </Link>
            </div>
            <div className="sidebar-playlists">
              {lists.data
                ?.filter((x) => x.ownerUserId === user?.userId)
                .slice(0, 5)
                .map((x, i) => (
                  <Link to={"/playlists/" + x.playlistId} key={x.playlistId}>
                    <span className={"playlist-dot art-" + i} />
                    {x.name}
                  </Link>
                ))}
              {!user && (
                <p>
                  Your collections
                  <br />
                  start with a sign in.
                </p>
              )}
            </div>
            {user?.roles.includes("admin") && (
              <nav className="admin-nav">
                <NavLink to="/admin">
                  <ShieldCheck />
                  Admin studio
                </NavLink>
              </nav>
            )}
            <div className="sidebar-bottom">
              <div className="connection">
                <span className="live-dot" /> LOCAL COLLECTION
              </div>
              <span>Made for the love of music.</span>
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <div className="breadcrumbs">
                <button aria-label="Go back" onClick={() => nav(-1)}>
                  <ChevronLeft size={19} />
                </button>
                <span>Music, without the noise.</span>
              </div>
              <div className="topbar-right">
                <Link
                  className="catalog-link"
                  to="/search"
                  aria-label="Browse catalog"
                >
                  <Search size={16} />
                  <span>Find your next favorite</span>
                </Link>
                {user ? (
                  <>
                    <Link to="/settings" className="user-chip">
                      <span>{user.displayName.slice(0, 1)}</span>
                      {user.displayName.split(" ")[0]}
                    </Link>
                    <button
                      aria-label="Sign out"
                      onClick={async () => {
                        await api("/auth/logout", "POST");
                        client.removeQueries({
                          predicate: (q) => q.queryKey[0] !== "/auth/me",
                        });
                        refresh();
                      }}
                    >
                      <LogOut size={16} />
                    </button>
                  </>
                ) : (
                  <button
                    className="button secondary small"
                    onClick={() => setModal(true)}
                  >
                    Sign in <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
            </header>
            <div className="content-columns">
              <main>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/playlists/:id" element={<PlaylistPage />} />
                  <Route
                    path="/artists/:id"
                    element={<EntityPage kind="artists" />}
                  />
                  <Route
                    path="/albums/:id"
                    element={<EntityPage kind="albums" />}
                  />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/stats" element={<StatsPage />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route
                    path="/admin/*"
                    element={
                      user?.roles.includes("admin") ? (
                        <Suspense
                          fallback={<Message>Loading admin studio…</Message>}
                        >
                          <Admin />
                        </Suspense>
                      ) : (
                        <Message>
                          Sign in with an administrator account to access the
                          studio.
                        </Message>
                      )
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <Message>
                        Page not found. <Link to="/">Go home</Link>
                      </Message>
                    }
                  />
                </Routes>
              </main>
              <PlayerRail />
            </div>
          </div>
          <PlayerBar />
        </div>
        {modal && <AuthModal close={() => setModal(false)} />}
      </PlayerProvider>
    </Auth.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </QueryClientProvider>,
);
