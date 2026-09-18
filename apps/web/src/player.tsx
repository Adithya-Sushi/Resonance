import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  Music2,
  ExternalLink,
  Radio,
} from "lucide-react";
import { type Song, mergeRanges, coverage } from "@resonance/shared";
import { api, client } from "./api";
export const duration = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
interface PlayerContext {
  song?: Song;
  queue: Song[];
  playing: boolean;
  play: (songs: Song[], index?: number, playlistId?: string) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  time: number;
  error: string;
  volume: number;
  setVolume: (v: number) => void;
  ready: boolean;
}
const Context = createContext<PlayerContext>(null!);
export const usePlayer = () => useContext(Context);
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}
export function PlayerProvider({
  children,
  user,
  onSignIn,
}: {
  children: ReactNode;
  user: any;
  onSignIn: () => void;
}) {
  const [queue, setQueue] = useState<Song[]>([]),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [error, setError] = useState(""),
    [volume, setVolume] = useState(70),
    [ready, setReady] = useState(false);
  const song = queue[index];
  const yt = useRef<any>(null),
    session = useRef<any>(null),
    songRef = useRef<Song | undefined>(undefined),
    context = useRef<any>({ type: "catalog" }),
    chain = useRef<Promise<any>>(Promise.resolve()),
    starting = useRef<Promise<any> | null>(null),
    callbacks = useRef<any>({}),
    generation = useRef(0),
    queueRef = useRef({ queue, index });
  queueRef.current = { queue, index };
  const sample = () => {
    if (!yt.current || !session.current) return;
    const p = Number(yt.current.getCurrentTime() || 0),
      now = performance.now(),
      s = session.current;
    const elapsed = (now - s.lastWall) / 1000,
      delta = p - s.lastPosition;
    if (
      yt.current.getPlayerState() === 1 &&
      delta > 0 &&
      delta <= elapsed + 0.6 &&
      elapsed < 2
    ) {
      s.playedSeconds += delta;
      s.coverageRanges = mergeRanges(
        [...s.coverageRanges, [s.lastPosition, p]],
        s.durationSecSnapshot,
      );
    }
    s.lastWall = now;
    s.lastPosition = p;
    setTime(p);
  };
  const checkpoint = (reason?: string) => {
    sample();
    const s = session.current;
    if (!s) return Promise.resolve();
    const payload = {
      seq: ++s.seq,
      playedSeconds: s.playedSeconds,
      coverageRanges: s.coverageRanges,
      ...(reason ? { endReason: reason } : {}),
    };
    if (reason) session.current = null;
    const send = () => api("/playback/" + s.sessionId, "PUT", payload);
    chain.current = chain.current
      .catch(() => {})
      .then(send)
      .catch(async (e) => {
        await new Promise((r) => setTimeout(r, 500));
        return send().catch(() => {
          setError(
            "Listening history could not sync. Playback remains available.",
          );
          throw e;
        });
      });
    chain.current.catch(() => {});
    return chain.current;
  };
  const finish = async (reason: string) => {
    if (starting.current) await starting.current.catch(() => {});
    const s = session.current;
    const resolved =
      reason === "skip" &&
      s &&
      coverage(s.coverageRanges, s.durationSecSnapshot) >= 0.9
        ? "stopped"
        : reason;
    await checkpoint(resolved).catch(() => {});
    client.invalidateQueries({ queryKey: ["/summary"] });
  };
  const change = async (offset: number, reason = "skip") => {
    yt.current?.pauseVideo();
    await finish(reason);
    const current = queueRef.current;
    const next = current.index + offset;
    if (next >= 0 && next < current.queue.length) {
      setIndex(next);
      generation.current++;
    } else setPlaying(false);
  };
  callbacks.current = {
    state: async (state: number) => {
      setPlaying(state === 1);
      if (
        state === 1 &&
        !session.current &&
        !starting.current &&
        songRef.current
      ) {
        const current = songRef.current,
          token = generation.current;
        starting.current = api("/playback", "POST", {
          sessionId: crypto.randomUUID(),
          songId: current.songId,
          context: context.current,
        })
          .then((s) => {
            if (token === generation.current)
              session.current = {
                ...s,
                lastPosition: yt.current.getCurrentTime(),
                lastWall: performance.now(),
              };
          })
          .catch((e) => {
            setError(e.message);
            yt.current?.pauseVideo();
          })
          .finally(() => {
            starting.current = null;
          });
      }
      if (state === 2) checkpoint().catch(() => {});
      if (state === 0) change(1, "ended");
    },
    error: (event: any) => {
      setError(
        `This video cannot play here (YouTube ${event.data}). Try another track or open it on YouTube.`,
      );
      finish("interrupted");
      setPlaying(false);
    },
  };
  useEffect(() => {
    const init = () => {
      if (yt.current) return;
      yt.current = new window.YT.Player("youtube-player", {
        width: "100%",
        height: "216",
        playerVars: { playsinline: 1, origin: location.origin, rel: 0 },
        events: {
          onReady: () => {
            setReady(true);
            yt.current.setVolume(70);
          },
          onStateChange: (e: any) => callbacks.current.state(e.data),
          onError: (e: any) => callbacks.current.error(e),
          onAutoplayBlocked: () =>
            setError("Your browser paused autoplay. Press play to continue."),
          onPlaybackRateChange: () => {
            if (yt.current.getPlaybackRate() !== 1)
              yt.current.setPlaybackRate(1);
          },
        },
      });
    };
    if (window.YT?.Player) init();
    else {
      window.onYouTubeIframeAPIReady = init;
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
    const timer = setInterval(() => sample(), 250),
      beat = setInterval(() => checkpoint().catch(() => {}), 10000);
    const hide = () => {
      if (document.hidden) yt.current?.pauseVideo();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    songRef.current = song;
    if (song && ready) {
      setError("");
      setTime(0);
      yt.current.loadVideoById(song.media.videoId);
    }
  }, [song?.songId, ready, index]);
  useEffect(() => {
    yt.current?.setVolume?.(volume);
  }, [volume]);
  useEffect(() => {
    if (!user) {
      yt.current?.pauseVideo();
      session.current = null;
      setQueue([]);
    }
  }, [user?.userId]);
  const play = async (songs: Song[], i = 0, playlistId?: string) => {
    if (!user) {
      onSignIn();
      return;
    }
    yt.current?.pauseVideo();
    await finish("stopped");
    generation.current++;
    context.current = playlistId
      ? { type: "playlist", playlistId }
      : { type: "catalog" };
    setQueue(songs);
    setIndex(i);
    if (song?.songId === songs[i]?.songId && ready)
      yt.current.loadVideoById(songs[i].media.videoId);
  };
  const toggle = () => {
    if (!song) return;
    if (playing) yt.current?.pauseVideo();
    else yt.current?.playVideo();
  };
  return (
    <Context.Provider
      value={{
        song,
        queue,
        playing,
        play,
        toggle,
        next: () => change(1),
        previous: () => change(-1, "stopped"),
        time,
        error,
        volume,
        setVolume,
        ready,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function PlayerRail() {
  const p = usePlayer();
  return (
    <aside className={"player-rail" + (p.song ? " has-track" : "")}>
      <div className="eyebrow rail-title">
        <Radio size={14} /> NOW PLAYING <span className="live-dot" />
      </div>
      <div className={"video-frame " + (!p.song ? "no-track" : "")}>
        <div id="youtube-player" />
        {!p.song && (
          <div className="player-placeholder">
            <div className="record-small">
              <Music2 size={28} />
            </div>
            <p>
              Your next favorite
              <br />
              is a play away.
            </p>
          </div>
        )}
      </div>
      {p.song ? (
        <>
          <div className="track-caption">
            <h3>{p.song.title}</h3>
            <p>{p.song.artists?.map((a) => a.name).join(", ")}</p>
            <a
              href={"https://www.youtube.com/watch?v=" + p.song.media.videoId}
              target="_blank"
              rel="noreferrer"
            >
              Watch on YouTube <ExternalLink size={12} />
            </a>
          </div>
          {p.error && (
            <p className="notice" role="alert">
              {p.error}
            </p>
          )}
          <div className="rail-divider" />
          <div className="section-heading">
            <h3>Up next</h3>
            <span>{p.queue.length} tracks</span>
          </div>
          <div className="queue-list">
            {p.queue.slice(0, 8).map((s, i) => (
              <button
                key={s.songId + i}
                className={
                  s.songId === p.song?.songId
                    ? "queue-item active"
                    : "queue-item"
                }
                onClick={() => p.play(p.queue, i)}
              >
                <span className={"mini-cover art-" + (i % 8)}>
                  <Music2 size={16} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.artists?.[0]?.name}</small>
                </span>
                <span className="muted">{duration(s.durationSec)}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="rail-empty">
          <span className="eyebrow">MAKE YOURSELF AT HOME</span>
          <h3>
            Less searching.
            <br />
            More discovering.
          </h3>
          <p>Pick a track, settle in, and let the music find you.</p>
          <div className="mini-wave">▂ ▄ ▆ █ ▅ ▂ ▄ ▇ ▃ ▅ ▂</div>
        </div>
      )}
      <div className="youtube-note">
        <span className="yt-mark">▶</span> Playback powered by YouTube
      </div>
    </aside>
  );
}
export function PlayerBar() {
  const p = usePlayer();
  return (
    <footer className="player-bar">
      <div className="bar-track">
        <div className="mini-cover art-2">
          <Music2 size={22} />
        </div>
        <div>
          <strong>{p.song?.title || "Find your frequency"}</strong>
          <small>
            {p.song?.artists?.map((a) => a.name).join(", ") ||
              "Choose something you love"}
          </small>
        </div>
      </div>
      <div className="transport">
        <div className="transport-buttons">
          <button
            aria-label="Previous track"
            disabled={!p.song}
            onClick={p.previous}
          >
            <SkipBack size={18} />
          </button>
          <button
            className="transport-play"
            aria-label={p.playing ? "Pause" : "Play"}
            disabled={!p.song}
            onClick={p.toggle}
          >
            {p.playing ? <Pause size={19} /> : <Play size={19} />}
          </button>
          <button aria-label="Next track" disabled={!p.song} onClick={p.next}>
            <SkipForward size={18} />
          </button>
        </div>
        <div className="progress-line">
          <span>{duration(p.time)}</span>
          <progress value={p.time} max={p.song?.durationSec || 1} />
          <span>{duration(p.song?.durationSec || 0)}</span>
        </div>
      </div>
      <label className="volume">
        <Volume2 size={18} />
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="100"
          value={p.volume}
          onChange={(e) => p.setVolume(+e.target.value)}
        />
      </label>
    </footer>
  );
}
