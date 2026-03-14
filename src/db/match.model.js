'use strict';

const mongoose = require('mongoose');

const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const TalentSchema = new Schema(
  {
    tier: { type: Number },
    name: { type: String },
  },
  { _id: false },
);

const PlayerSchema = new Schema(
  {
    toonHandle: { type: String },
    playerName: { type: String },
    hero: { type: String },
    heroShort: { type: String },
    talents: { type: [TalentSchema], default: [] },
  },
  { _id: false },
);

const TeamSchema = new Schema(
  {
    teamIndex: { type: Number },
    win: { type: Boolean },
    bans: { type: [String], default: [] },
    players: { type: [PlayerSchema], default: [] },
  },
  { _id: false },
);

const EventSchema = new Schema(
  {
    type: { type: String },
    time: { type: Number },
    team: { type: Number },
    subject: { type: String },
    target: { type: String },
    details: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

// ---------------------------------------------------------------------------
// Top-level Match schema
// ---------------------------------------------------------------------------

const MatchSchema = new Schema(
  {
    fingerprint: { type: String, unique: true },
    filename: { type: String },
    replayPath: { type: String },
    gameDate: { type: Date },
    map: { type: String },
    gameMode: { type: String },
    duration: { type: Number },
    teams: { type: [TeamSchema], default: [] },
    events: { type: [EventSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'matches',
  },
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// fingerprint already has a unique index from the field definition above.

MatchSchema.index({ gameDate: 1 });
MatchSchema.index({ gameMode: 1 });
MatchSchema.index({ 'teams.players.toonHandle': 1 });

// ---------------------------------------------------------------------------
// Model export
// ---------------------------------------------------------------------------

// Guard against re-registration when running under --watch (hot reload).
const Match = mongoose.models.Match || mongoose.model('Match', MatchSchema);

module.exports = {
  Match,
  MatchSchema,
  TeamSchema,
  PlayerSchema,
  TalentSchema,
  EventSchema,
};
