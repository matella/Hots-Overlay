#[tokio::main]
async fn main() {
    let path = r"C:\Users\matth\Documents\Heroes of the Storm\Accounts\142414274\2-Hero-1-2844614\Replays\Multiplayer\2024-08-18 16.35.38 Cursed Hollow.StormReplay";
    let filename = std::path::Path::new(path).file_name().unwrap().to_string_lossy().to_string();
    let file_bytes = tokio::fs::read(path).await.unwrap();
    println!("File: {}, size: {}", filename, file_bytes.len());

    let client = reqwest::Client::new();
    let resp = client
        .post("https://hots-overlay.azurewebsites.net/api/upload-raw")
        .header("Content-Type", "application/octet-stream")
        .header("X-Filename", &filename)
        .body(file_bytes)
        .send().await.unwrap();
    println!("Response: {}", resp.text().await.unwrap());
}
