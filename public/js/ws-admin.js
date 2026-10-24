/**
 * 管理端 WebSocket：全 Node 实时数据
 * 鉴权后持续接收：admin/overview、admin/roomList、room/created、room/destroyed、room/updated；
 * 订阅某房间后额外接收该房间内聊天与事件。
 */

let ws = null;
let token = null;
let subscribedRoomId = null;
let onRoomEvent = null;
let onAdminMessage = null;
let reconnectTimer = null;
const RECONNECT_DELAY = 3000;

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

function connect(t) {
  token = t;
  if (ws && ws.readyState === WebSocket.OPEN) return;
  const url = getWsUrl();
  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'admin/auth', data: { token } }));
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'admin/auth' || msg.type === 'admin/subscribe' || msg.type === 'admin/unsubscribe') {
        if (msg.success && msg.type === 'admin/auth') {
          window.dispatchEvent(new CustomEvent('admin:ws-connected'));
          if (subscribedRoomId) {
            ws.send(JSON.stringify({ type: 'admin/subscribe', data: { roomId: subscribedRoomId } }));
          }
        }
        return;
      }
      if (onAdminMessage) onAdminMessage(msg);
      if (subscribedRoomId && onRoomEvent && (msg.type === 'chat/message' || msg.type?.startsWith('room/'))) {
        onRoomEvent(msg);
      }
    } catch (_) {}
  };

  ws.onclose = () => {
    ws = null;
    window.dispatchEvent(new CustomEvent('admin:ws-closed'));
    if (token && reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(token);
      }, RECONNECT_DELAY);
    }
  };

  ws.onerror = () => {};
}

function disconnect() {
  token = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscribedRoomId = null;
  onRoomEvent = null;
  onAdminMessage = null;
}

function setOnAdminMessage(callback) {
  onAdminMessage = callback;
}

function subscribe(roomId, callback) {
  subscribedRoomId = roomId;
  onRoomEvent = callback;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'admin/subscribe', data: { roomId } }));
  }
}

function unsubscribe() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'admin/unsubscribe' }));
  }
  subscribedRoomId = null;
  onRoomEvent = null;
}

function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

export const wsAdmin = {
  connect,
  disconnect,
  setOnAdminMessage,
  subscribe,
  unsubscribe,
  isConnected,
};
