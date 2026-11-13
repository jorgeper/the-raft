import XCTest
@testable import PiggyBank

final class KidTests: XCTestCase {
    
    func testKidCreation() {
        let id = UUID()
        let kid = Kid(id: id, name: "Test Kid", balance: 100.50, avatarImageName: "test-avatar")
        
        XCTAssertEqual(kid.id, id)
        XCTAssertEqual(kid.name, "Test Kid")
        XCTAssertEqual(kid.balance, 100.50)
        XCTAssertEqual(kid.avatarImageName, "test-avatar")
    }
    
    func testKidDecoding() throws {
        let json = """
        {
            "id": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
            "name": "Xabi",
            "balance": 47.25,
            "avatarImageName": "TestData/xabi-avatar"
        }
        """.data(using: .utf8)!
        
        let decoder = JSONDecoder()
        let kid = try decoder.decode(Kid.self, from: json)
        
        XCTAssertEqual(kid.id.uuidString, "A1B2C3D4-E5F6-7890-ABCD-EF1234567890")
        XCTAssertEqual(kid.name, "Xabi")
        XCTAssertEqual(kid.balance, 47.25)
        XCTAssertEqual(kid.avatarImageName, "TestData/xabi-avatar")
    }
    
    func testKidArrayDecoding() throws {
        let json = """
        [
            {
                "id": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
                "name": "Xabi",
                "balance": 47.25,
                "avatarImageName": "TestData/xabi-avatar"
            },
            {
                "id": "B2C3D4E5-F6A7-8901-BCDE-F23456789012",
                "name": "Yago",
                "balance": 132.50,
                "avatarImageName": "TestData/yago-avatar"
            }
        ]
        """.data(using: .utf8)!
        
        let decoder = JSONDecoder()
        let kids = try decoder.decode([Kid].self, from: json)
        
        XCTAssertEqual(kids.count, 2)
        XCTAssertEqual(kids[0].name, "Xabi")
        XCTAssertEqual(kids[1].name, "Yago")
        XCTAssertEqual(kids[0].balance, 47.25)
        XCTAssertEqual(kids[1].balance, 132.50)
    }
}