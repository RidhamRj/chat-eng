import  {WebSocketServer ,WebSocket}from "ws";

const wss = new WebSocketServer({ port: 8080 });


interface User{
    socket:WebSocket;
    room:string;
}
let users:User[] = [];

let userCount = 0;
let allsockets:WebSocket[] = [];
wss.on("connection", (socket) => {
  userCount++;
  console.log(`New user connected. Total users: ${userCount}`);
 

    socket.on("message", (message:string) => {
        const parsedMessage = JSON.parse(message);
        const room=parsedMessage.payload.roomId;
        if (parsedMessage.type === "join") {
            users.push({ socket, room });
            console.log(`User joined room: ${room}`);
        }
        if (parsedMessage.type === "chat") {
            const currentRoom = users.find((user) => user.socket === socket)?.room;
            for(let user of users){
                if(user.room===currentRoom){
                    user.socket.send((parsedMessage.payload.message));
                }}
        }

    })  


  socket.on("close", () => {
    userCount--;
    allsockets = allsockets.filter((s) => s !== socket);
    console.log(`User disconnected. Total users: ${userCount}`);
    
});

});