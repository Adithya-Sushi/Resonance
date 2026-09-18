import { useState, useEffect, useRef } from "react";
import { NavLink, Routes, Route, Link } from "react-router-dom";
import {
  Upload,
  Database,
  Network,
  Activity,
  Plus,
  RefreshCw,
  Check,
  ArrowRight,
  Trash2,
  Pencil,
  X,
} from "lucide-react";
import cytoscape from "cytoscape";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { youtubeId } from "@resonance/shared";
import { api, useApi, refresh } from "./api";
import { PageTitle, Message } from "./main";
export function Admin() {
  return (
    <>
      <PageTitle
        eyebrow="BEHIND THE MUSIC"
        title="Admin studio"
        description="Shape the collection. Explore the connections."
      />
      <nav className="tabs">
        {[
          ["", "Overview", Activity],
          ["catalog", "Catalog", Database],
          ["imports", "Import music", Upload],
          ["analytics", "Analytics", Activity],
          ["graph", "Graph explorer", Network],
        ].map(([url, label, Icon]: any) => (
          <NavLink end to={"/admin" + (url ? "/" + url : "")} key={label}>
            <Icon size={15} />
            {label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="imports" element={<Imports />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="graph" element={<GraphExplorer />} />
      </Routes>
    </>
  );
}
function Overview() {
  const status = useApi("/admin/status", true, 10000),
    quality = useApi("/admin/quality"),
    [notice, setNotice] = useState("");
  const run = async (action: string) => {
    try {
      await api("/admin/" + action, "POST");
      setNotice("Request queued. The worker will process it shortly.");
      refresh();
    } catch (e) {
      setNotice((e as Error).message);
    }
  };
  return (
    <>
      {status.error && <Message>{status.error.message}</Message>}
      <div className="stat-grid">
        {["pending", "processed", "failed"].map((k) => (
          <div className="stat-card" key={k}>
            <span>{k} sync tasks</span>
            <strong>
              {status.data?.counts.find((x: any) => x._id === k)?.count || 0}
            </strong>
          </div>
        ))}
        <div className="stat-card">
          <span>Oldest pending</span>
          <strong>
            {Math.round(status.data?.oldestPendingAgeSeconds || 0)}
            <small>s</small>
          </strong>
        </div>
      </div>
      <div className="panel">
        <h2>System health</h2>
        <div className="health-line">
          <span>Graph synchronization</span>
          <span
            className={
              "badge " + (status.data?.worker?.healthy ? "good" : "warn")
            }
          >
            {status.data?.worker?.healthy ? "Healthy" : "Waiting / recovering"}
          </span>
        </div>
        <div className="health-line">
          <span>YouTube import API</span>
          <span
            className={
              "badge " + (status.data?.youtubeConfigured ? "good" : "warn")
            }
          >
            {status.data?.youtubeConfigured ? "Configured" : "API key needed"}
          </span>
        </div>
        <p className="muted">
          Last sync:{" "}
          {status.data?.worker?.lastSyncAt
            ? new Date(status.data.worker.lastSyncAt).toLocaleString()
            : "Not yet synced"}
        </p>
        {status.data?.worker?.error && (
          <Message>{status.data.worker.error}</Message>
        )}
        <div className="action-line">
          <button className="button secondary" onClick={() => run("retry")}>
            <RefreshCw size={15} />
            Retry failed tasks
          </button>
          <button className="button secondary" onClick={() => run("reconcile")}>
            Rebuild graph
          </button>
          <button
            className="button secondary"
            onClick={() => run("analytics-refresh")}
          >
            Refresh algorithms
          </button>
        </div>
      </div>
      {notice && <Message>{notice}</Message>}
      <div className="panel">
        <h2>Data quality</h2>
        {quality.data?.checks.map((x: any) => (
          <div className="health-line" key={x.check}>
            <code>{x.check}</code>
            <span className={"badge " + (!x.violations ? "good" : "warn")}>
              {x.violations} violations
            </span>
          </div>
        ))}
      </div>
      {status.data?.failed.length > 0 && (
        <div className="panel">
          <h3>Failed tasks</h3>
          {status.data.failed.map((x: any) => (
            <Message key={x.taskId}>
              {x.aggregateType} · {x.attempts} attempts · {x.lastError}
            </Message>
          ))}
        </div>
      )}
    </>
  );
}
function Catalog() {
  const [kind, setKind] = useState("songs"),
    [edit, setEdit] = useState<any>(null),
    [error, setError] = useState("");
  const data = useApi(
      kind === "songs" ? "/songs?limit=50&includeRetired=true" : "/" + kind,
    ),
    artists = useApi<any[]>("/artists"),
    albums = useApi<any[]>("/albums"),
    genres = useApi<any[]>("/genres");
  const rows = kind === "songs" ? data.data?.items : data.data;
  const key =
    kind === "songs" ? "songId" : kind === "artists" ? "artistId" : "albumId";
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      let body: any;
      if (kind === "artists")
        body = {
          name: f.get("name"),
          bio: f.get("bio"),
          country: f.get("country"),
          genreIds: f.getAll("genres"),
        };
      else if (kind === "albums")
        body = {
          title: f.get("title"),
          artistIds: f.getAll("artists"),
          releaseDate: f.get("releaseDate"),
          type: f.get("type"),
        };
      else {
        const id = youtubeId(String(f.get("video")));
        if (!id) throw new Error("Enter a valid YouTube video URL");
        body = {
          title: f.get("title"),
          artistCredits: f.getAll("artists").map((artistId, i) => ({
            artistId,
            role: i ? "featured" : "primary",
          })),
          albumId: f.get("albumId"),
          genreIds: f.getAll("genres"),
          durationSec: Number(f.get("durationSec")),
          language: f.get("language"),
          trackNumber: Number(f.get("trackNumber")),
          discNumber: 1,
          media: { provider: "youtube", videoId: id },
        };
      }
      await api(
        "/admin/" + kind + (edit[key] ? "/" + edit[key] : ""),
        edit[key] ? "PUT" : "POST",
        body,
      );
      setEdit(null);
      setError("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="action-line">
        <select
          aria-label="Catalog type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setEdit(null);
          }}
        >
          {["songs", "artists", "albums"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <button className="button primary" onClick={() => setEdit({})}>
          <Plus size={16} />
          Add {kind.slice(0, -1)}
        </button>
        <Link className="button secondary" to="/admin/imports">
          <Upload size={16} />
          Import from YouTube
        </Link>
      </div>
      {error && <Message>{error}</Message>}
      {edit && (
        <form onSubmit={save} className="form-panel">
          <div className="section-heading">
            <h2>
              {edit[key] ? "Edit" : "Add"} {kind.slice(0, -1)}
            </h2>
            <button
              type="button"
              aria-label="Close editor"
              onClick={() => setEdit(null)}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            {kind === "artists" ? "Name" : "Title"}
            <input
              required
              name={kind === "artists" ? "name" : "title"}
              defaultValue={edit.name || edit.title}
            />
          </label>
          {kind === "artists" ? (
            <>
              <label>
                Biography
                <textarea name="bio" defaultValue={edit.bio} />
              </label>
              <label>
                Country
                <input name="country" defaultValue={edit.country} />
              </label>
            </>
          ) : (
            <label>
              Artist credits (select all performers)
              <select
                multiple
                required
                name="artists"
                defaultValue={
                  edit.artistIds ||
                  edit.artistCredits?.map((a: any) => a.artistId) ||
                  []
                }
              >
                {artists.data?.map((a) => (
                  <option value={a.artistId} key={a.artistId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "albums" && (
            <>
              <label>
                Release date
                <input
                  type="date"
                  required
                  name="releaseDate"
                  defaultValue={edit.releaseDate?.slice(0, 10)}
                />
              </label>
              <label>
                Release type
                <select name="type" defaultValue={edit.type || "album"}>
                  <option>album</option>
                  <option>single</option>
                  <option>ep</option>
                </select>
              </label>
            </>
          )}
          {kind === "songs" && (
            <>
              <label>
                Album
                <select
                  required
                  name="albumId"
                  defaultValue={edit.albumId || ""}
                >
                  <option value="">Select an album</option>
                  {albums.data?.map((a) => (
                    <option value={a.albumId} key={a.albumId}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                YouTube video URL
                <input
                  name="video"
                  required
                  defaultValue={
                    edit.media?.videoId
                      ? "https://www.youtube.com/watch?v=" + edit.media.videoId
                      : ""
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  Video duration (seconds)
                  <input
                    type="number"
                    required
                    min="1"
                    name="durationSec"
                    defaultValue={edit.durationSec}
                  />
                </label>
                <label>
                  Language
                  <input
                    required
                    name="language"
                    defaultValue={edit.language}
                  />
                </label>
                <label>
                  Track number
                  <input
                    type="number"
                    required
                    min="1"
                    name="trackNumber"
                    defaultValue={edit.trackNumber || 1}
                  />
                </label>
              </div>
              {edit.media?.videoId && (
                <iframe
                  className="preview-video"
                  title="Video preview"
                  src={"https://www.youtube.com/embed/" + edit.media.videoId}
                />
              )}
            </>
          )}
          {kind !== "albums" && (
            <fieldset>
              <legend>Genres</legend>
              <div className="checkbox-grid">
                {genres.data?.map((g) => (
                  <label key={g.genreId}>
                    <input
                      type="checkbox"
                      name="genres"
                      value={g.genreId}
                      defaultChecked={edit.genreIds?.includes(g.genreId)}
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button className="button primary">Save {kind.slice(0, -1)}</button>
        </form>
      )}
      <div className="panel">
        {rows?.map((row: any) => (
          <div className="health-line" key={row[key]}>
            <div>
              <strong>{row.title || row.name}</strong>
              <small>{row.status}</small>
            </div>
            <div className="row-actions">
              <button
                aria-label={"Edit " + (row.title || row.name)}
                onClick={() => setEdit(row)}
              >
                <Pencil size={16} />
              </button>
              <button
                aria-label={"Retire " + (row.title || row.name)}
                onClick={async () => {
                  if (
                    confirm(
                      "Retire this record? Existing history will be preserved.",
                    )
                  )
                    try {
                      await api("/admin/" + kind + "/" + row[key], "DELETE");
                      refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function Imports() {
  const jobs = useApi<any[]>("/admin/imports", true, 5000),
    [jobId, setJobId] = useState(""),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const job = useApi("/admin/imports/" + jobId, !!jobId, 3000);
  const [excluded, setExcluded] = useState<string[]>([]);
  useEffect(() => setExcluded([]), [jobId]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const j = await api("/admin/imports", "POST", { input });
      setJobId(j.jobId);
      setError("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    setBusy(true);
    try {
      const videoIds = job.data.rows
        .filter(
          (x: any) =>
            x.status === "ready" && x.reviewed && !excluded.includes(x.videoId),
        )
        .map((x: any) => x.videoId);
      const results: any[] = [];
      for (let start = 0; start < videoIds.length; start += 200) {
        const response = await api(
          "/admin/imports/" + jobId + "/publish",
          "POST",
          { videoIds: videoIds.slice(start, start + 200) },
        );
        results.push(...response.results);
      }
      setError(
        results
          .filter((x: any) => x.status === "error")
          .map((x: any) => x.error)
          .join("; ") || "Selected music published to the catalog.",
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="import-banner">
        <Upload size={28} />
        <div>
          <h2>A whole playlist. One import.</h2>
          <p>YouTube finds the videos. MusicBrainz helps fill in the music.</p>
        </div>
      </div>
      <form className="form-panel" onSubmit={create}>
        <label>
          YouTube links
          <textarea
            required
            rows={3}
            placeholder="Paste a public playlist URL, or one video link per line…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy}>
          <Upload size={16} />
          Prepare import
        </button>
        <p className="muted">
          Uses your server’s YouTube API key. Review artist and release matches
          before publishing.
        </p>
      </form>
      {error && <Message>{error}</Message>}
      <label>
        Import history
        <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
          <option value="">Select an import</option>
          {jobs.data?.map((j) => (
            <option value={j.jobId} key={j.jobId}>
              {new Date(j.createdAt).toLocaleString()} · {j.status} ·{" "}
              {j.videoIds.length} videos
            </option>
          ))}
        </select>
      </label>
      {job.data && (
        <>
          <div className="section-heading spaced">
            <h2>Review your import</h2>
            <span className="badge">{job.data.status}</span>
          </div>
          {job.data.error && <Message>{job.data.error}</Message>}
          <div className="action-line">
            <button
              className="button primary"
              disabled={
                busy ||
                !job.data.rows.some(
                  (x: any) =>
                    x.reviewed &&
                    x.status === "ready" &&
                    !excluded.includes(x.videoId),
                )
              }
              onClick={publish}
            >
              <Check size={16} />
              Publish selected rows
            </button>
            <button
              className="button secondary"
              onClick={async () => {
                await api("/admin/imports/" + jobId + "/retry", "POST");
                refresh();
              }}
            >
              <RefreshCw size={15} />
              Retry processing
            </button>
          </div>
          {job.data.rows.map((row: any) => (
            <div key={row.videoId}>
              {row.reviewed && row.status === "ready" && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={!excluded.includes(row.videoId)}
                    onChange={(e) =>
                      setExcluded((xs) =>
                        e.target.checked
                          ? xs.filter((x) => x !== row.videoId)
                          : [...xs, row.videoId],
                      )
                    }
                  />{" "}
                  Select {row.youtube?.title || row.videoId} for publication
                </label>
              )}
              <ImportRow row={row} jobId={jobId} />
            </div>
          ))}
        </>
      )}
    </>
  );
}
function ImportRow({ row, jobId }: { row: any; jobId: string }) {
  const [draft, setDraft] = useState<any>(row.draft || {}),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState(false);
  const genres = useApi<any[]>("/genres"),
    artists = useApi<any[]>("/artists"),
    albums = useApi<any[]>("/albums");
  const field = (name: string, value: any) =>
    setDraft((d: any) => ({ ...d, [name]: value }));
  const [matching, setMatching] = useState(false);
  const select = async (suggestion: any, release: any) => {
    setMatching(true);
    setError("");
    setDraft((d: any) => ({
      ...d,
      artistId: undefined,
      albumId: undefined,
      title: suggestion.title,
      artistName: suggestion.artists[0]?.name || "",
      artistMusicbrainzId: suggestion.artists[0]?.id,
      additionalArtists: suggestion.artists.slice(1).map((a: any) => ({
        name: a.name,
        musicbrainzId: a.id,
        role: "primary",
      })),
      musicbrainzId: suggestion.recordingId,
      albumTitle: release?.title || "",
      albumMusicbrainzId: release?.id,
      releaseDate: release?.date?.length === 10 ? release.date : "",
      type:
        release?.type === "Single"
          ? "single"
          : release?.type === "EP"
            ? "ep"
            : "album",
    }));
    try {
      const details = await api<any>(
        `/admin/imports/${jobId}/rows/${row.videoId}/match`,
        "POST",
        { recordingId: suggestion.recordingId, releaseId: release?.id },
      );
      setDraft((d: any) => ({
        ...d,
        ...(details.trackNumber
          ? { trackNumber: details.trackNumber, discNumber: details.discNumber }
          : {}),
        ...(details.releaseDate ? { releaseDate: details.releaseDate } : {}),
        ...(details.genreIds.length ? { genreIds: details.genreIds } : {}),
      }));
      setError(
        details.suggestedGenres.length
          ? `Suggested genres: ${details.suggestedGenres.join(", ")}. Review the selected genres below.`
          : "No genres supplied for this recording. Select genres below.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMatching(false);
    }
  };
  return (
    <article className="import-row">
      <div className="section-heading">
        <div>
          <h3>{row.youtube?.title || row.videoId}</h3>
          <small>
            {row.reviewed ? "Reviewed · " : ""}
            {row.status}
            {row.warning ? " · " + row.warning : ""}
          </small>
        </div>
        {row.status === "ready" && (
          <button
            className="button secondary small"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Collapse" : "Review metadata"}
          </button>
        )}
      </div>
      {row.error && <Message>{row.error}</Message>}
      {row.publishError && <Message>{row.publishError}</Message>}
      {expanded && (
        <>
          <iframe
            className="preview-video"
            title={"Preview " + row.videoId}
            src={"https://www.youtube.com/embed/" + row.videoId}
          />
          <h4>Suggested recordings</h4>
          {row.suggestions?.map((s: any) => (
            <div className="suggestion" key={s.recordingId}>
              <strong>
                {s.title} · {s.artists.map((a: any) => a.name).join(", ")}
              </strong>
              <small>
                {s.disambiguation || "Check that this is the correct recording"}{" "}
                ·{" "}
                {s.length
                  ? Math.round(s.length / 1000) + " seconds"
                  : "Duration unknown"}
              </small>
              {s.releases.length ? (
                s.releases.map((r: any) => (
                  <button
                    className="text-button"
                    disabled={matching}
                    key={r.id}
                    onClick={() => select(s, r)}
                  >
                    Use {r.title} · {r.date || "date unknown"}{" "}
                    <ArrowRight size={13} />
                  </button>
                ))
              ) : (
                <button
                  className="text-button"
                  disabled={matching}
                  onClick={() => select(s, null)}
                >
                  Use recording; enter release manually
                </button>
              )}
            </div>
          ))}
          <form
            className="form-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(
                  "/admin/imports/" + jobId + "/rows/" + row.videoId,
                  "PATCH",
                  draft,
                );
                setError("Saved for publication");
                refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <div className="form-grid">
              {[
                ["title", "Song title"],
                ["artistName", "Artist name"],
                ["albumTitle", "Album title"],
                ["releaseDate", "Release date"],
                ["language", "Language"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type={key === "releaseDate" ? "date" : "text"}
                    required={
                      !(
                        (key === "artistName" && draft.artistId) ||
                        (key === "albumTitle" && draft.albumId)
                      )
                    }
                    value={draft[key] || ""}
                    onChange={(e) => field(key, e.target.value)}
                  />
                </label>
              ))}
              <label>
                Release type
                <select
                  value={draft.type || "album"}
                  onChange={(e) => field("type", e.target.value)}
                >
                  <option>album</option>
                  <option>single</option>
                  <option>ep</option>
                </select>
              </label>
              <label>
                Existing artist (optional)
                <select
                  value={draft.artistId || ""}
                  onChange={(e) =>
                    field("artistId", e.target.value || undefined)
                  }
                >
                  <option value="">Create / match by MusicBrainz ID</option>
                  {artists.data?.map((a) => (
                    <option key={a.artistId} value={a.artistId}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Existing album (optional)
                <select
                  value={draft.albumId || ""}
                  onChange={(e) =>
                    field("albumId", e.target.value || undefined)
                  }
                >
                  <option value="">Create / match by MusicBrainz ID</option>
                  {albums.data?.map((a) => (
                    <option key={a.albumId} value={a.albumId}>
                      {a.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Track number
                <input
                  type="number"
                  min="1"
                  value={draft.trackNumber || 1}
                  onChange={(e) => field("trackNumber", +e.target.value)}
                />
              </label>
            </div>
            {draft.additionalArtists?.length > 0 && (
              <div>
                <h4>Additional performer credits</h4>
                {draft.additionalArtists.map((a: any, i: number) => (
                  <div className="health-line" key={a.musicbrainzId || i}>
                    <span>{a.name}</span>
                    <select
                      aria-label={"Credit role for " + a.name}
                      value={a.role}
                      onChange={(e) =>
                        field(
                          "additionalArtists",
                          draft.additionalArtists.map(
                            (credit: any, j: number) =>
                              j === i
                                ? { ...credit, role: e.target.value }
                                : credit,
                          ),
                        )
                      }
                    >
                      <option value="primary">Primary</option>
                      <option value="featured">Featured</option>
                    </select>
                    <button
                      type="button"
                      aria-label={"Remove credit " + a.name}
                      onClick={() =>
                        field(
                          "additionalArtists",
                          draft.additionalArtists.filter(
                            (_: any, j: number) => i !== j,
                          ),
                        )
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <fieldset>
              <legend>Genres</legend>
              <div className="checkbox-grid">
                {genres.data?.map((g) => (
                  <label key={g.genreId}>
                    <input
                      type="checkbox"
                      checked={(draft.genreIds || []).includes(g.genreId)}
                      onChange={(e) =>
                        field(
                          "genreIds",
                          e.target.checked
                            ? [...(draft.genreIds || []), g.genreId]
                            : (draft.genreIds || []).filter(
                                (x: string) => x !== g.genreId,
                              ),
                        )
                      }
                    />
                    {g.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="muted">
              Video duration: {row.youtube?.durationSec}s. This is used for
              playback tracking.
            </p>
            <button className="button primary">Save reviewed metadata</button>
            {error && <Message>{error}</Message>}
          </form>
        </>
      )}
    </article>
  );
}
function Analytics() {
  const queryList = useApi("/admin/queries"),
    [id, setId] = useState("A1"),
    [params, setParams] = useState({
      playlistId: "",
      artistId: "",
      otherArtistId: "",
    });
  const result = useApi(
      "/admin/" +
        (id.startsWith("A") ? "analytics/" : "cypher/") +
        id +
        "?" +
        new URLSearchParams(params),
    ),
    status = useApi("/admin/status");
  const lists = useApi<any[]>("/playlists"),
    artists = useApi<any[]>("/artists");
  const rows = result.data?.rows || [],
    chart = rows
      .filter((x: any) => x.name || x.songId)
      .slice(0, 10)
      .map((x: any) => ({
        name: (x.name || x.songId).slice(0, 20),
        value: x.plays || x.seconds || x.creditedSongs || 0,
      }));
  return (
    <>
      <div className="filters">
        <select
          aria-label="Query"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {Object.entries({
            ...queryList.data?.aggregations,
            ...queryList.data?.cypher,
          }).map(([key, name]) => (
            <option key={key} value={key}>
              {key} · {String(name)}
            </option>
          ))}
        </select>
        {id === "C7" && (
          <select
            aria-label="Public playlist"
            value={params.playlistId}
            onChange={(e) =>
              setParams({ ...params, playlistId: e.target.value })
            }
          >
            <option value="">Choose a playlist</option>
            {lists.data
              ?.filter((x) => x.visibility === "public")
              .map((x) => (
                <option key={x.playlistId} value={x.playlistId}>
                  {x.name}
                </option>
              ))}
          </select>
        )}
        {id === "C8" &&
          ["artistId", "otherArtistId"].map((key) => (
            <select
              aria-label={key}
              key={key}
              value={(params as any)[key]}
              onChange={(e) => setParams({ ...params, [key]: e.target.value })}
            >
              <option value="">Choose artist</option>
              {artists.data?.map((x) => (
                <option key={x.artistId} value={x.artistId}>
                  {x.name}
                </option>
              ))}
            </select>
          ))}
      </div>
      {result.error && <Message>{result.error.message}</Message>}
      <div className="panel">
        <h2>{result.data?.name}</h2>
        <p className="muted">
          Calculated{" "}
          {result.data?.calculatedAt
            ? new Date(result.data.calculatedAt).toLocaleString()
            : ""}{" "}
          · Application activity
        </p>
        {chart.length > 0 && (
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chart}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#929a8e", fontSize: 10 }}
                />
                <YAxis tick={{ fill: "#929a8e", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: "#20251e",
                    border: "1px solid #414a39",
                  }}
                />
                <Bar dataKey="value" fill="#cef374" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="data-output">
          <pre>{JSON.stringify(rows, null, 2)}</pre>
        </div>
      </div>
      <div className="panel">
        <h2>Graph Data Science</h2>
        <p className="muted">
          {status.data?.analytics?.scope || "Awaiting first calculation"} ·{" "}
          {status.data?.analytics?.calculatedAt
            ? new Date(status.data.analytics.calculatedAt).toLocaleString()
            : ""}
        </p>
        <h3>Song degree: distinct opted-in listeners</h3>
        <pre className="data-output">
          {JSON.stringify(status.data?.analytics?.degrees || [], null, 2)}
        </pre>
        <h3>User Node Similarity: Jaccard overlap</h3>
        <pre className="data-output">
          {JSON.stringify(status.data?.analytics?.similarities || [], null, 2)}
        </pre>
      </div>
    </>
  );
}
function GraphExplorer() {
  const [root, setRoot] = useState("");
  const data = useApi("/admin/graph" + (root ? "?root=" + root : "")),
    container = useRef<HTMLDivElement>(null),
    [type, setType] = useState("All"),
    [selected, setSelected] = useState<any>(null);
  useEffect(() => {
    if (!data.data || !container.current) return;
    const nodes = data.data.nodes.filter(
      (n: any) => type === "All" || n.data.type === type,
    );
    const ids = new Set(nodes.map((n: any) => n.data.id));
    const edges = data.data.edges.filter(
      (e: any) => ids.has(e.data.source) && ids.has(e.data.target),
    );
    const cy = cytoscape({
      container: container.current,
      elements: [...nodes, ...edges],
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#cef374",
            label: "data(label)",
            color: "#d8dfd0",
            "font-size": 9,
            "text-margin-y": 7,
            "text-valign": "bottom",
            width: 16,
            height: 16,
          },
        },
        {
          selector: 'node[type="Song"]',
          style: { "background-color": "#d89674" },
        },
        {
          selector: 'node[type="User"]',
          style: { "background-color": "#97a4ef" },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#454c40",
            "target-arrow-color": "#454c40",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
          },
        },
        {
          selector: ":selected",
          style: { "background-color": "#fff", "line-color": "#fff" },
        },
      ],
      layout: { name: "cose", animate: false, nodeRepulsion: () => 12000 },
      minZoom: 0.2,
      maxZoom: 4,
    });
    cy.on("tap", "node,edge", (e) => setSelected(e.target.data()));
    return () => cy.destroy();
  }, [data.data, type]);
  return (
    <>
      <div className="section-heading">
        <h2>The connections behind the music</h2>
        <select
          aria-label="Node type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {["All", "Song", "Artist", "Album", "Genre", "Playlist", "User"].map(
            (x) => (
              <option key={x}>{x}</option>
            ),
          )}
        </select>
      </div>
      <p className="muted">
        Drag to explore. Scroll to zoom. Select a node or relationship for
        details. Limited to 350 relationships.
      </p>
      {data.error && <Message>{data.error.message}</Message>}
      <div className="graph-canvas" ref={container} />
      {root && (
        <button
          className="text-button"
          onClick={() => {
            setRoot("");
            setSelected(null);
          }}
        >
          Show overview
        </button>
      )}
      {selected && (
        <div>
          <pre className="data-output">{JSON.stringify(selected, null, 2)}</pre>
          {selected.type && (
            <button
              className="button secondary"
              onClick={() => {
                setRoot(selected.id);
                setType("All");
              }}
            >
              Explore this node’s connections
            </button>
          )}
        </div>
      )}
    </>
  );
}
