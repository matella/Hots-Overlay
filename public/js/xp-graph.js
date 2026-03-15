/**
 * XP Lead Graph — Canvas 2D component for HotS match detail page.
 *
 * Usage:
 *   drawXpGraph(canvasElement, {
 *     xpTimeline: [{ time, lead }],
 *     events:     [{ type, time, team }],
 *     duration:   1200,
 *     myTeam:     0
 *   });
 */

// eslint-disable-next-line no-unused-vars
function drawXpGraph(canvas, data) {
  'use strict';

  var xpTimeline = data.xpTimeline || [];
  var events     = data.events || [];
  var duration   = data.duration || 1;
  var myTeam     = data.myTeam || 0;

  // ── Negate lead values when viewer is team 1 ────────────────────────
  var points = xpTimeline.map(function (p) {
    return { time: p.time, lead: myTeam === 1 ? -p.lead : p.lead };
  });

  // ── Sizing ──────────────────────────────────────────────────────────
  var container = canvas.parentElement;
  var dpr       = window.devicePixelRatio || 1;
  var cssW      = container.clientWidth;
  var cssH      = Math.round(cssW / 3);

  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // ── Layout regions (in CSS px) ──────────────────────────────────────
  var MARGIN_LEFT   = 45;
  var MARGIN_RIGHT  = 10;
  var MARGIN_TOP    = 10;

  var graphH  = Math.round(cssH * 0.75);
  var stripH  = Math.round(cssH * 0.15);
  var legendH = cssH - graphH - stripH;

  var plotW = cssW - MARGIN_LEFT - MARGIN_RIGHT;
  var plotH = graphH - MARGIN_TOP;

  var stripTop  = graphH;
  var legendTop = graphH + stripH;

  // ── Helpers ─────────────────────────────────────────────────────────

  function timeToX(t) {
    return MARGIN_LEFT + (t / duration) * plotW;
  }

  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatLead(v) {
    var abs = Math.abs(v);
    if (abs >= 1000) {
      var k = abs / 1000;
      return (v < 0 ? '-' : '') + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
    }
    return String(v);
  }

  // ── Compute Y-axis scale ────────────────────────────────────────────
  var maxAbs = 0;
  for (var i = 0; i < points.length; i++) {
    var a = Math.abs(points[i].lead);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs === 0) maxAbs = 1000;

  // Pick a nice interval
  var niceIntervals = [500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  var yInterval = 1000;
  for (var ni = 0; ni < niceIntervals.length; ni++) {
    if (maxAbs / niceIntervals[ni] <= 4) { yInterval = niceIntervals[ni]; break; }
  }
  var yMax = Math.ceil(maxAbs / yInterval) * yInterval;
  if (yMax === 0) yMax = yInterval;

  function leadToY(lead) {
    // zero-line is center of plot area
    var center = MARGIN_TOP + plotH / 2;
    return center - (lead / yMax) * (plotH / 2);
  }

  // ── Background ──────────────────────────────────────────────────────
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, cssW, cssH);

  // ── Grid lines (horizontal) ─────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'middle';

  for (var yv = -yMax; yv <= yMax; yv += yInterval) {
    var gy = leadToY(yv);
    if (yv === 0) continue; // draw zero-line separately
    ctx.beginPath();
    ctx.moveTo(MARGIN_LEFT, gy);
    ctx.lineTo(cssW - MARGIN_RIGHT, gy);
    ctx.stroke();

    // Y-axis label
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'right';
    ctx.fillText(formatLead(yv), MARGIN_LEFT - 4, gy);
  }

  // Zero line
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, leadToY(0));
  ctx.lineTo(cssW - MARGIN_RIGHT, leadToY(0));
  ctx.stroke();

  // Y-axis 0 label
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'right';
  ctx.fillText('0', MARGIN_LEFT - 4, leadToY(0));

  // ── Grid lines (vertical, every 5 min) + X-axis labels ─────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (var t5 = 300; t5 < duration; t5 += 300) {
    var gx = timeToX(t5);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(gx, MARGIN_TOP);
    ctx.lineTo(gx, graphH);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(formatTime(t5), gx, graphH - 12);
  }

  // ── Plot XP lead curve ──────────────────────────────────────────────
  if (points.length > 1) {
    // We draw two passes: one for segments above zero, one for below,
    // filling to the zero-line with appropriate colors.
    var zeroY = leadToY(0);

    // Build pixel-coordinate list
    var pts = [];
    for (var pi = 0; pi < points.length; pi++) {
      pts.push({ x: timeToX(points[pi].time), y: leadToY(points[pi].lead), lead: points[pi].lead });
    }

    // Draw filled regions by splitting at zero crossings
    drawFilledRegion(ctx, pts, zeroY, true,  'rgba(96,165,250,0.3)');
    drawFilledRegion(ctx, pts, zeroY, false, 'rgba(248,113,113,0.3)');

    // Draw line on top, colored per segment
    for (var li = 0; li < pts.length - 1; li++) {
      var above = (pts[li].lead + pts[li + 1].lead) / 2 >= 0;
      ctx.strokeStyle = above ? '#60a5fa' : '#f87171';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[li].x, pts[li].y);
      ctx.lineTo(pts[li + 1].x, pts[li + 1].y);
      ctx.stroke();
    }
  }

  // ── Event strip ─────────────────────────────────────────────────────
  // Separator line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN_LEFT, stripTop);
  ctx.lineTo(cssW - MARGIN_RIGHT, stripTop);
  ctx.stroke();

  // Strip background
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillRect(MARGIN_LEFT, stripTop, plotW, stripH);

  var stripMidY = stripTop + stripH / 2;

  // Pre-compute event dot positions for hit-testing later
  var eventDots = [];

  for (var ei = 0; ei < events.length; ei++) {
    var ev   = events[ei];
    var ex   = timeToX(ev.time);
    var eColor, eRadius;

    if (ev.type === 'kill') {
      eColor = (ev.team === myTeam) ? '#60a5fa' : '#f87171';
    } else if (ev.type === 'objective') {
      eColor = '#fbbf24';
    } else if (ev.type === 'fort_destroyed') {
      eColor = '#fb923c';
    } else if (ev.type === 'merc_capture') {
      eColor = '#4ade80';
    } else {
      eColor = '#888';
    }
    eRadius = ev.type === 'fort_destroyed' ? 4 : 3;

    ctx.globalAlpha = 0.8;
    ctx.fillStyle = eColor;
    ctx.beginPath();
    ctx.arc(ex, stripMidY, eRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    eventDots.push({ x: ex, y: stripMidY, r: eRadius, ev: ev, color: eColor });
  }

  // ── Legend ──────────────────────────────────────────────────────────
  var legendItems = [
    { label: 'Kill',      color: '#60a5fa' },
    { label: 'Death',     color: '#f87171' },
    { label: 'Objective', color: '#fbbf24' },
    { label: 'Structure', color: '#fb923c' },
    { label: 'Merc',      color: '#4ade80' }
  ];

  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  var dotR   = 4;
  var dotGap = 6;   // gap from dot edge to text
  var itemGap = 16; // gap between items

  // Measure total width
  var totalLegendW = 0;
  for (var lm = 0; lm < legendItems.length; lm++) {
    totalLegendW += dotR * 2 + dotGap + ctx.measureText(legendItems[lm].label).width;
    if (lm < legendItems.length - 1) totalLegendW += itemGap;
  }

  var lx = (cssW - totalLegendW) / 2;
  var ly = legendTop + legendH / 2;

  for (var ld = 0; ld < legendItems.length; ld++) {
    var item = legendItems[ld];
    // dot
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(lx + dotR, ly, dotR, 0, Math.PI * 2);
    ctx.fill();
    lx += dotR * 2 + dotGap;
    // text
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(item.label, lx, ly);
    lx += ctx.measureText(item.label).width + itemGap;
  }

  // ── Tooltip div ─────────────────────────────────────────────────────
  var tooltip = document.createElement('div');
  tooltip.style.cssText = 'background:rgba(0,0,0,0.9);color:#e5e7eb;font-size:10px;' +
    'padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.15);' +
    'pointer-events:none;position:absolute;z-index:100;white-space:nowrap;display:none;';
  canvas.parentElement.style.position = 'relative';
  canvas.parentElement.appendChild(tooltip);

  // ── Crosshair overlay canvas (so we don't repaint main canvas) ─────
  // Instead we just redraw on each hover (simpler for this use-case).
  // We store the full image and restore it before drawing crosshair.
  var snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

  canvas.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    // Restore snapshot
    ctx.putImageData(snapshot, 0, 0);

    var shown = false;

    // Check event dots first
    for (var di = 0; di < eventDots.length; di++) {
      var d = eventDots[di];
      var dx = mx - d.x;
      var dy = my - d.y;
      if (dx * dx + dy * dy <= 64) { // within 8px
        var label = eventLabel(d.ev);
        tooltip.textContent = label + ' \u2014 ' + formatTime(d.ev.time);
        tooltip.style.display = 'block';
        positionTooltip(tooltip, d.x, d.y - 16, cssW);
        shown = true;
        break;
      }
    }

    // Graph area crosshair + lead readout
    if (mx >= MARGIN_LEFT && mx <= cssW - MARGIN_RIGHT && my >= MARGIN_TOP && my <= graphH) {
      // Find nearest time
      var hoverTime = ((mx - MARGIN_LEFT) / plotW) * duration;
      var nearest = null;
      var bestDist = Infinity;
      for (var hi = 0; hi < points.length; hi++) {
        var dist = Math.abs(points[hi].time - hoverTime);
        if (dist < bestDist) { bestDist = dist; nearest = points[hi]; }
      }

      // Vertical crosshair
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, MARGIN_TOP);
      ctx.lineTo(mx, graphH);
      ctx.stroke();
      ctx.restore();

      if (nearest && !shown) {
        var sign = nearest.lead >= 0 ? '+' : '';
        tooltip.textContent = formatTime(Math.round(hoverTime)) +
          ' \u2014 XP Lead: ' + sign + formatLead(nearest.lead);
        tooltip.style.display = 'block';
        positionTooltip(tooltip, mx, leadToY(nearest.lead) - 16, cssW);
        shown = true;
      }
    }

    if (!shown) {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', function () {
    tooltip.style.display = 'none';
    ctx.putImageData(snapshot, 0, 0);
  });

  // ── Internal helpers ───────────────────────────────────────────────

  function eventLabel(ev) {
    if (ev.type === 'kill')           return ev.team === myTeam ? 'Kill' : 'Death';
    if (ev.type === 'objective')      return 'Objective';
    if (ev.type === 'fort_destroyed') return 'Structure';
    if (ev.type === 'merc_capture')   return 'Merc';
    return ev.type;
  }

  function positionTooltip(el, x, y, maxW) {
    var tw = el.offsetWidth || 60;
    var left = x - tw / 2;
    if (left < 0) left = 0;
    if (left + tw > maxW) left = maxW - tw;
    el.style.left = left + 'px';
    el.style.top  = y + 'px';
  }

  /**
   * Draw a filled region between the curve and the zero-line.
   * @param {boolean} above  — true = fill only where lead >= 0
   */
  function drawFilledRegion(c, pts, zy, above, fillColor) {
    // Walk segments; at each zero-crossing, insert an interpolated point.
    c.fillStyle = fillColor;
    c.beginPath();

    var started = false;

    for (var si = 0; si < pts.length; si++) {
      var cur = pts[si];
      var curAbove = cur.lead >= 0;

      if (si > 0) {
        var prev = pts[si - 1];
        var prevAbove = prev.lead >= 0;

        // Detect crossing
        if (curAbove !== prevAbove) {
          // Interpolate x at zero crossing
          var frac = prev.lead / (prev.lead - cur.lead);
          var cx = prev.x + frac * (cur.x - prev.x);

          if (started) {
            c.lineTo(cx, zy);
            c.lineTo(cx, zy); // close to zero
            // Close back along zero to start
            c.closePath();
            c.fill();
            c.beginPath();
            started = false;
          }

          // Start new region if current side matches
          if ((above && curAbove) || (!above && !curAbove)) {
            c.moveTo(cx, zy);
            c.lineTo(cur.x, cur.y);
            started = true;
          }
          continue;
        }
      }

      var side = cur.lead >= 0;
      if ((above && side) || (!above && !side)) {
        if (!started) {
          c.moveTo(cur.x, zy);
          started = true;
        }
        c.lineTo(cur.x, cur.y);
      }
    }

    // Close final region
    if (started && pts.length > 0) {
      var last = pts[pts.length - 1];
      c.lineTo(last.x, zy);
      c.closePath();
      c.fill();
    }
  }
}
