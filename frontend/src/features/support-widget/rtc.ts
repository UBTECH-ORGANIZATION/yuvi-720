/**
 * Widget side of the WebRTC link.
 *
 * The supporter is always the offerer, so this side only ever answers. Whatever local
 * media the learner has agreed to at the moment the offer arrives - the display stream,
 * the microphone, or both - is attached to the answer. When the learner adds or removes
 * media the supporter re-offers, so the peer connection is rebuilt from scratch rather
 * than renegotiated; a rebuild is a few hundred milliseconds and cannot desynchronise.
 */

interface IceServerConfig {
  urls: string[]
  username?: string | null
  credential?: string | null
}

export class WidgetPeer {
  private pc: RTCPeerConnection | null = null
  private iceServers: RTCIceServer[] = []

  constructor(
    private readonly send: (type: string, payload: Record<string, unknown>) => void,
    private readonly localStreams: () => MediaStream[],
    private readonly onRemoteStream: (stream: MediaStream) => void,
  ) {}

  async loadIceServers(baseUrl: string, token: string): Promise<void> {
    try {
      const response = await fetch(`${baseUrl}/intake/ice`, {
        headers: { authorization: `Bearer ${token}` },
      })
      if (!response.ok) return
      const body = (await response.json()) as { ice_servers: IceServerConfig[] }
      this.iceServers = (body.ice_servers ?? []).map((server) => ({
        urls: server.urls,
        username: server.username ?? undefined,
        credential: server.credential ?? undefined,
      }))
    } catch {
      // No TURN means direct connections only; the DOM stream still works.
      this.iceServers = []
    }
  }

  async onOffer(description: RTCSessionDescriptionInit): Promise<void> {
    this.close()
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    this.pc = pc

    pc.onicecandidate = (event) => {
      if (event.candidate) this.send('rtc.ice', { candidate: event.candidate.toJSON() })
    }

    const remote = new MediaStream()
    pc.ontrack = (event) => {
      remote.addTrack(event.track)
      this.onRemoteStream(remote)
    }

    for (const stream of this.localStreams()) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream)
    }

    await pc.setRemoteDescription(description)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.send('rtc.answer', { description: { type: answer.type, sdp: answer.sdp } })
  }

  async onIce(candidate: RTCIceCandidateInit): Promise<void> {
    await this.pc?.addIceCandidate(candidate).catch(() => undefined)
  }

  /** Tears the peer connection down; local tracks are owned by the caller. */
  close(): void {
    this.pc?.close()
    this.pc = null
  }
}
