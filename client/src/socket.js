import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || undefined;

const socket = io(URL, { autoConnect: false });

export default socket;
