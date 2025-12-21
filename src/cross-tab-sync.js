/**
 * Cross-tab synchronization for sequencer clock
 * Allows tabs with tempo=0 to follow the clock of tabs with tempo>0
 */
export class CrossTabSync {
	constructor(clock) {
		this.clock = clock;
		this.channel = new BroadcastChannel('big-dipper-clock');
		this.tabId = this.generateTabId();
		this.isLeader = false;
		this.isFollower = false;
		this.currentLeaderId = null;
		this.availableLeaders = new Map();
		this.leaderAnnounceInterval = null;
		this.leaderTimeout = null;
		this.tickCallback = null;
		this.leaderMaxBPM = null;
		this.leaderSettings = null;

		this.channel.addEventListener('message', this.handleMessage.bind(this));
	}

	/**
	 * Generate a unique ID for this tab
	 */
	generateTabId() {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * Handle incoming messages from other tabs
	 */
	handleMessage(event) {
		const { type, data } = event.data;

		switch (type) {
			case 'tick':
				if (this.isFollower && data.tabId === this.currentLeaderId) {
					if (this.tickCallback) {
						this.tickCallback(data.time, data.tickCount, data.settings);
					}
				}
				if (this.availableLeaders.has(data.tabId)) {
					const leader = this.availableLeaders.get(data.tabId);
					leader.lastSeen = Date.now();
				}
				break;

			case 'leader-announce':
				if (!this.isLeader || data.tabId !== this.tabId) {
					this.availableLeaders.set(data.tabId, {
						lastSeen: Date.now(),
						bpm: data.bpm,
						maxBPM: data.maxBPM,
						settings: data.settings,
					});

					if (this.isFollower && !this.currentLeaderId) {
						this.currentLeaderId = data.tabId;
						if (this.tickCallback && data.settings !== undefined && data.settings !== null) {
							this.tickCallback(null, 0, data.settings);
						}
					} else if (this.isFollower && this.currentLeaderId === data.tabId) {
						if (this.tickCallback && data.settings !== undefined && data.settings !== null) {
							this.tickCallback(null, 0, data.settings);
						}
					}
				}
				break;

			case 'leader-stop':
				this.availableLeaders.delete(data.tabId);

				if (this.isFollower && this.currentLeaderId === data.tabId) {
					this.selectNewLeader();
				}
				break;
		}
	}

	/**
	 * Select a new leader from available leaders
	 */
	selectNewLeader() {
		const now = Date.now();
		for (const [tabId, leader] of this.availableLeaders.entries()) {
			if (now - leader.lastSeen > 3000) {
				this.availableLeaders.delete(tabId);
			}
		}

		const leaders = Array.from(this.availableLeaders.keys());
		if (leaders.length > 0) {
			this.currentLeaderId = leaders[0];
		} else {
			this.currentLeaderId = null;
		}
	}

	/**
	 * Start acting as a leader (BPM > 0)
	 * @param {number} bpm - The current BPM
	 * @param {number} maxBPM - The maximum BPM to broadcast at
	 * @param {number} settings - The settings value for tempo calculation
	 */
	startLeader(bpm, maxBPM, settings) {
		if (this.isLeader) return;

		this.stopFollower();

		this.isLeader = true;
		this.isFollower = false;
		this.leaderMaxBPM = maxBPM;
		this.leaderSettings = settings;

		this.announceLeader(bpm, maxBPM, settings);

		this.leaderAnnounceInterval = setInterval(() => {
			if (this.isLeader) {
				this.announceLeader(bpm, maxBPM, settings);
			}
		}, 1500);
	}

	/**
	 * Stop acting as a leader (BPM -> 0)
	 */
	stopLeader() {
		if (!this.isLeader) return;

		this.isLeader = false;

		this.channel.postMessage({
			type: 'leader-stop',
			data: { tabId: this.tabId },
		});

		this.availableLeaders.delete(this.tabId);

		if (this.leaderAnnounceInterval) {
			clearInterval(this.leaderAnnounceInterval);
			this.leaderAnnounceInterval = null;
		}
	}

	/**
	 * Announce this tab as a leader
	 */
	announceLeader(bpm, maxBPM, settings) {
		this.channel.postMessage({
			type: 'leader-announce',
			data: { tabId: this.tabId, bpm, maxBPM, settings },
		});
	}

	/**
	 * Broadcast a tick event at maximum rate
	 * @param {number} time - Audio context time or performance time
	 * @param {number} tickCount - The tick count
	 * @param {number} settings - The settings value for tempo calculation
	 */
	broadcastTick(time, tickCount, settings) {
		if (this.isLeader && this.leaderSettings !== undefined) {
			this.channel.postMessage({
				type: 'tick',
				data: { tabId: this.tabId, time, tickCount, settings },
			});
		}
	}

	/**
	 * Start acting as a follower (BPM = 0)
	 */
	startFollower(tickCallback) {
		if (this.isFollower) return;

		this.stopLeader();

		this.isFollower = true;
		this.isLeader = false;
		this.tickCallback = tickCallback;

		this.selectNewLeader();

		if (this.currentLeaderId && this.availableLeaders.has(this.currentLeaderId)) {
			const leader = this.availableLeaders.get(this.currentLeaderId);
			if (leader && leader.settings !== undefined && leader.settings !== null && this.tickCallback) {
				this.tickCallback(null, 0, leader.settings);
			}
		}

		this.leaderTimeout = setInterval(() => {
			if (this.isFollower) {
				const now = Date.now();
				for (const [tabId, leader] of this.availableLeaders.entries()) {
					if (now - leader.lastSeen > 3000) {
						this.availableLeaders.delete(tabId);
						if (this.currentLeaderId === tabId) {
							this.selectNewLeader();
							if (this.currentLeaderId && this.availableLeaders.has(this.currentLeaderId)) {
								const newLeader = this.availableLeaders.get(this.currentLeaderId);
								if (
									newLeader &&
									newLeader.settings !== undefined &&
									newLeader.settings !== null &&
									this.tickCallback
								) {
									this.tickCallback(null, 0, newLeader.settings);
								}
							}
						}
					}
				}

				if (!this.currentLeaderId) {
					this.selectNewLeader();
					if (this.currentLeaderId && this.availableLeaders.has(this.currentLeaderId)) {
						const newLeader = this.availableLeaders.get(this.currentLeaderId);
						if (
							newLeader &&
							newLeader.settings !== undefined &&
							newLeader.settings !== null &&
							this.tickCallback
						) {
							this.tickCallback(null, 0, newLeader.settings);
						}
					}
				}
			}
		}, 1000);
	}

	/**
	 * Stop acting as a follower
	 */
	stopFollower() {
		if (!this.isFollower) return;

		this.isFollower = false;
		this.currentLeaderId = null;
		this.tickCallback = null;

		if (this.leaderTimeout) {
			clearInterval(this.leaderTimeout);
			this.leaderTimeout = null;
		}
	}

	/**
	 * Cleanup when shutting down
	 */
	destroy() {
		this.stopLeader();
		this.stopFollower();
		this.channel.close();
	}
}
